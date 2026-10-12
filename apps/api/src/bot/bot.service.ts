import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { evaluateSequenceAt, loadAvailabilityFacts } from '../availability/availability.engine.js';
import { formatMinute, parseWorkDate } from '../collaborator-work/collaborator-work.rules.js';
import { loadTieBreakFacts } from '../booking/booking.core.js';
import { planAssignment } from '../booking/booking.planner.js';
import { PrismaService } from '../platform/prisma.service.js';
import { API_ENVIRONMENT, API_LOGGER, type ApiEnvironment } from '../platform/tokens.js';
import { parsePublicProductsQuery } from '../products/public-products.logic.js';
import { PublicWebsiteService } from '../website/popup.service.js';
import {
  botProducts,
  botPromotions,
  botServices,
  botShop,
  type BotLocale,
  type PromotionSource,
} from './bot.serializers.js';

/** An answer the listener sends as is: a status and a code, never a stack or a driver message. */
export class BotError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SERVICES = 3;
const MAX_DAYS_AHEAD = 90;

/**
 * Claude integration Wave A (CI-B1): the data the chat bot reads. Everything comes from the public site's own readers (which carry no
 * cost, quantity, internal id or customer data) or from a narrow query of its own, and every answer passes through an allow-list
 * serializer (`bot.serializers.ts`). Read only: nothing here writes, and booking stays member-only (the bot can only link to the page).
 */
@Injectable()
export class BotDataService {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(API_LOGGER) private readonly logger: Logger,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PublicWebsiteService) private readonly website: PublicWebsiteService,
  ) {}

  private locale(query: URLSearchParams): BotLocale {
    const value = query.get('locale') ?? 'vi';
    if (value !== 'vi' && value !== 'en') throw new BotError(400, 'LOCALE');
    return value;
  }

  private async branches() {
    return this.prisma.client.branch.findMany({
      where: { isActive: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { code: true, name: true },
    });
  }

  async shop(query: URLSearchParams) {
    const locale = this.locale(query);
    const [site, branches] = await Promise.all([this.website.site(locale), this.branches()]);
    return { locale, shop: botShop(site, locale, branches, new Date()) };
  }

  async services(query: URLSearchParams) {
    const locale = this.locale(query);
    return { locale, ...botServices(await this.website.services(locale)) };
  }

  /** Programs the Owner ticked, without a code, active now and inside their window; never anything else. */
  async promotions(query: URLSearchParams) {
    const locale = this.locale(query);
    const now = new Date();
    const rows = await this.prisma.client.discount.findMany({
      where: { botVisible: true, requiresCode: false, isActive: true, terminatedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        code: true,
        nameVi: true,
        nameEn: true,
        versions: {
          orderBy: { versionNo: 'desc' },
          take: 1,
          select: {
            kind: true,
            percentBp: true,
            fixedAmountVnd: true,
            minSpendVnd: true,
            scope: true,
            validFrom: true,
            validUntil: true,
          },
        },
      },
    });
    const sources: PromotionSource[] = rows.flatMap((row) => {
      const version = row.versions[0];
      if (!version || version.validFrom > now || version.validUntil < now) return [];
      return [{ code: row.code, nameVi: row.nameVi, nameEn: row.nameEn, version }];
    });
    const site = await this.website.site(locale);
    return { locale, promotions: botPromotions(sources, locale, site.timezone).items };
  }

  async products(query: URLSearchParams) {
    const locale = this.locale(query);
    const raw: Record<string, unknown> = {};
    for (const key of ['q', 'category', 'brand', 'sort', 'page']) {
      const value = query.get(key);
      if (value !== null) raw[key] = value;
    }
    const result = await this.website.products(locale, parsePublicProductsQuery(raw));
    return { locale, products: botProducts(result, locale, this.environment.webOrigin) };
  }

  /**
   * Start times for one branch, one date and one to three services: the booking planner with the employee choice fixed to ANY and no
   * customer. Times only: no names, no schedules, no rooms. Advisory, as for members; the customer signs in to book.
   */
  async availability(query: URLSearchParams) {
    const locale = this.locale(query);
    const date = query.get('date') ?? '';
    if (!DATE.test(date)) throw new BotError(400, 'DATE');
    const codes = [
      ...new Set(
        (query.get('services') ?? '')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      ),
    ];
    if (codes.length < 1 || codes.length > MAX_SERVICES) throw new BotError(400, 'SERVICES');
    const today = new Date();
    const day = Date.parse(`${date}T00:00:00Z`);
    if (
      Number.isNaN(day) ||
      day < today.getTime() - 2 * 86_400_000 ||
      day > today.getTime() + MAX_DAYS_AHEAD * 86_400_000
    ) {
      throw new BotError(400, 'DATE');
    }
    const client = this.prisma.client;
    const branchCode = query.get('branch');
    const branch = await client.branch.findFirst({
      where: { isActive: true, ...(branchCode ? { code: branchCode } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, code: true },
    });
    if (!branch) throw new BotError(404, 'BRANCH');
    const services = await client.service.findMany({
      where: { code: { in: codes }, isActive: true },
      select: { id: true, code: true },
    });
    if (services.length !== codes.length) throw new BotError(404, 'SERVICE');
    const byCode = new Map(services.map((service) => [service.code, service.id]));
    const serviceIds = codes.map((code) => byCode.get(code)!);
    const starts = await client.$transaction(async (tx) => {
      const facts = await loadAvailabilityFacts(tx, {
        branchId: branch.id,
        serviceDate: date,
        serviceIds,
        context: 'BOOKING',
        now: new Date(),
      });
      if (!facts.window) return [] as string[];
      const tie = await loadTieBreakFacts(tx, {
        branchId: branch.id,
        date: parseWorkDate(date, 'date'),
        employeeUserIds: facts.employees.map((employee) => employee.userId),
      });
      const lines = serviceIds.map((serviceId) => ({ serviceId, employeeUserId: null }));
      const out: string[] = [];
      const step = facts.settings.slotIntervalMinutes;
      for (let minute = facts.window.startMinute; minute < facts.window.endMinute; minute += step) {
        if (planAssignment(evaluateSequenceAt(facts, minute), lines, tie).ok)
          out.push(formatMinute(minute));
      }
      return out;
    });
    // Bookings are member-only: the link opens the booking page; the customer signs in and confirms there.
    const bookingUrl = `${this.environment.webOrigin}/${locale}/book?branch=${encodeURIComponent(branch.code)}&services=${codes.map(encodeURIComponent).join(',')}&date=${date}`;
    return { locale, availability: { branch: branch.code, date, starts, bookingUrl } };
  }

  /** One bundle for the bot's prompt: shop, services, promotions and the first page of products. */
  async knowledge(query: URLSearchParams) {
    // One after the other: four readers at once would take four database connections of a small pool for one request.
    const shop = await this.shop(query);
    const services = await this.services(query);
    const promotions = await this.promotions(query);
    const products = await this.products(new URLSearchParams([['locale', this.locale(query)]]));
    return {
      locale: shop.locale,
      shop: shop.shop,
      groups: services.groups,
      promotions: promotions.promotions,
      products: products.products,
    };
  }

  health() {
    return { ok: true, version: 'bot-v1' };
  }
}
