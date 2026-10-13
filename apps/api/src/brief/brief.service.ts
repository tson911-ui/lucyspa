import { randomUUID } from 'node:crypto';
import {
  BRIEF_LIMITS,
  type BriefBlock,
  type CustomerBrief,
  type ProductSuggestion,
  type ProductSuggestions,
} from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import {
  BRIEF_SCHEMA,
  BRIEF_SYSTEM,
  ClaudeClient,
  SUGGESTION_SYSTEM,
  buildBriefUserMessage,
  buildSuggestionUserMessage,
  checkBriefSummary,
  checkSuggestionLine,
  costMicroUsd,
  isAiModel,
  loadAiSettings,
  maxCostMicroUsd,
  parseBrief,
  parseSuggestions,
  releaseReservation,
  reserveSpend,
  suggestionSchema,
  writeLedger,
  type AiModel,
  type AiSettings,
  type GenerateResult,
  type SuggestionCandidate,
} from '@lucy-spa/server';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import {
  auditView,
  briefFacts,
  expiryOf,
  hashOf,
  requireLine,
  servicesToday,
  suggestionCandidates,
  type LineAccess,
} from './brief.core.js';

/**
 * Claude integration Wave D (CI-S2 and CI-S3): the customer summary and the product talking points for the staff member serving a visit.
 * Built switched off (`brief_enabled`, default false). The facts are computed by code; only the condensing of staff notes and the pick from
 * a short list use the model, and both results are cached with the visit until 7 days after the service. A view is audited (who, which
 * visit line, which part; never the content). The model sees an anonymous "khách", never a name, phone, e-mail or address.
 */
const MAX_TOKENS = 700;
const CALL_TIMEOUT_MS = 30_000;

export interface BriefDependencies {
  client?: ClaudeClient;
}

interface Plan<T> {
  access: LineAccess;
  settings: AiSettings;
  model: AiModel;
  reservationId: string | null;
  cached: T | null;
}

@Injectable()
export class BriefService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  env: NodeJS.ProcessEnv = process.env;
  private injected: BriefDependencies = {};

  use(dependencies: BriefDependencies): this {
    this.injected = dependencies;
    return this;
  }

  private client(): ClaudeClient {
    return (
      this.injected.client ??
      new ClaudeClient({
        apiKey: this.env['ANTHROPIC_API_KEY']?.trim() || undefined,
        baseUrl: this.env['ANTHROPIC_BASE_URL']?.trim() || undefined,
      })
    );
  }

  // ------------------------------------------------------------------------------------------------------------------ the summary

  async brief(
    token: string | undefined,
    lineId: string,
    requestId?: string,
  ): Promise<CustomerBrief> {
    const prepared = await this.run(token, requestId, async (context) => {
      const access = await requireLine(context, lineId);
      const settings = await loadAiSettings(context.tx);
      const block = blockOf(settings, this.client().hasKey);
      await auditView(context, access, 'BRIEF');
      if (!settings.briefEnabled) return { off: true as const, block: block ?? 'BRIEF_OFF' };
      const { facts, notes } = await briefFacts(context, access);
      const hash = hashOf('brief', ...notes);
      const cached =
        notes.length === 0
          ? null
          : await cachedPayload<{ summary: string }>(context, access, 'BRIEF', hash);
      let plan: Plan<string> | null = null;
      if (notes.length > 0 && cached === null && block === null && isAiModel(settings.briefModel)) {
        const model = settings.briefModel;
        const reservation = await reserveSpend(context.tx, {
          feature: 'BRIEF',
          itemId: randomUUID(),
          amountMicroUsd: maxCostMicroUsd(model, 8_000, MAX_TOKENS),
          settings,
          now: context.now,
        });
        plan = {
          access,
          settings,
          model,
          reservationId: reservation.ok ? reservation.reservationId : null,
          cached: null,
        };
      }
      return { off: false as const, facts, notes, hash, cached, plan, block, access, settings };
    });
    if (prepared.off) {
      return {
        available: false,
        block: prepared.block,
        facts: null,
        summary: null,
        summaryStatus: 'NONE',
      };
    }
    const { facts, notes, cached, plan } = prepared;
    if (notes.length === 0) {
      return { available: true, block: null, facts, summary: null, summaryStatus: 'NONE' };
    }
    if (cached !== null) {
      return {
        available: true,
        block: null,
        facts,
        summary: cached.summary,
        summaryStatus: 'READY',
      };
    }
    if (plan === null || plan.reservationId === null) {
      return {
        available: true,
        block: prepared.block,
        facts,
        summary: null,
        summaryStatus: 'UNAVAILABLE',
      };
    }
    // The call, outside any transaction; then the ledger row, the hold and the cache together.
    let result: GenerateResult | null;
    try {
      result = await this.client().generateJson({
        model: plan.model,
        effort: 'low',
        system: BRIEF_SYSTEM,
        user: buildBriefUserMessage(facts, notes),
        schema: BRIEF_SCHEMA as unknown as Record<string, unknown>,
        maxTokens: MAX_TOKENS,
        timeoutMs: CALL_TIMEOUT_MS,
        refusalFallback: plan.settings.refusalFallback,
      });
    } catch {
      result = null;
    }
    const summary = result?.outcome === 'OK' ? parseBrief(result.json) : null;
    const kept =
      summary !== null &&
      summary !== '' &&
      checkBriefSummary(summary, notes, {
        authenticityClaimsAllowed: plan.settings.allowAuthenticityClaims,
        bannedPhrases: plan.settings.bannedPhrases,
        maxChars: BRIEF_LIMITS.summaryChars,
      }).length === 0
        ? summary
        : null;
    await this.settle(
      token,
      requestId,
      plan,
      result,
      'BRIEF',
      prepared.hash,
      kept === null ? null : { summary: kept },
    );
    return {
      available: true,
      block: null,
      facts,
      summary: kept,
      summaryStatus: kept === null ? 'UNAVAILABLE' : 'READY',
    };
  }

  // ------------------------------------------------------------------------------------------------------------------ talking points

  async suggestions(
    token: string | undefined,
    lineId: string,
    requestId?: string,
  ): Promise<ProductSuggestions> {
    const prepared = await this.run(token, requestId, async (context) => {
      const access = await requireLine(context, lineId);
      const settings = await loadAiSettings(context.tx);
      const block = blockOf(settings, this.client().hasKey);
      await auditView(context, access, 'SUGGESTIONS');
      if (!settings.briefEnabled) return { off: true as const, block: block ?? 'BRIEF_OFF' };
      const candidates = await suggestionCandidates(context, access);
      const services = await servicesToday(context, access);
      const { facts } = await briefFacts(context, access);
      const hash = hashOf(
        'suggestions',
        ...services,
        ...facts.productsBefore,
        ...candidates.map((c) => c.id),
      );
      const cached =
        candidates.length === 0
          ? null
          : await cachedPayload<{ items: ProductSuggestion[] }>(
              context,
              access,
              'SUGGESTIONS',
              hash,
            );
      let plan: Plan<ProductSuggestion[]> | null = null;
      if (
        candidates.length > 0 &&
        cached === null &&
        block === null &&
        isAiModel(settings.briefModel)
      ) {
        const model = settings.briefModel;
        const reservation = await reserveSpend(context.tx, {
          feature: 'SUGGESTIONS',
          itemId: randomUUID(),
          amountMicroUsd: maxCostMicroUsd(model, 10_000, MAX_TOKENS),
          settings,
          now: context.now,
        });
        plan = {
          access,
          settings,
          model,
          reservationId: reservation.ok ? reservation.reservationId : null,
          cached: null,
        };
      }
      return {
        off: false as const,
        candidates,
        services,
        boughtBefore: facts.productsBefore,
        hash,
        cached,
        plan,
        block,
      };
    });
    if (prepared.off) return { available: false, block: prepared.block, items: [], status: 'NONE' };
    const { candidates, cached, plan } = prepared;
    if (candidates.length === 0) return { available: true, block: null, items: [], status: 'NONE' };
    if (cached !== null) {
      return {
        available: true,
        block: null,
        items: cached.items,
        status: cached.items.length > 0 ? 'READY' : 'NONE',
      };
    }
    if (plan === null || plan.reservationId === null) {
      return { available: true, block: prepared.block, items: [], status: 'UNAVAILABLE' };
    }
    let result: GenerateResult | null;
    try {
      result = await this.client().generateJson({
        model: plan.model,
        effort: 'low',
        system: SUGGESTION_SYSTEM,
        user: buildSuggestionUserMessage(prepared.services, prepared.boughtBefore, candidates),
        schema: suggestionSchema(candidates.map((candidate) => candidate.id)) as unknown as Record<
          string,
          unknown
        >,
        maxTokens: MAX_TOKENS,
        timeoutMs: CALL_TIMEOUT_MS,
        refusalFallback: plan.settings.refusalFallback,
      });
    } catch {
      result = null;
    }
    const picks =
      result?.outcome === 'OK'
        ? parseSuggestions(result.json, candidates, BRIEF_LIMITS.suggestions)
        : null;
    const byId = new Map<string, SuggestionCandidate>(
      candidates.map((candidate) => [candidate.id, candidate]),
    );
    const items: ProductSuggestion[] = [];
    for (const pick of picks ?? []) {
      const candidate = byId.get(pick.productId);
      if (
        candidate !== undefined &&
        pick.line !== '' &&
        checkSuggestionLine(pick.line, candidate, {
          authenticityClaimsAllowed: plan.settings.allowAuthenticityClaims,
          bannedPhrases: plan.settings.bannedPhrases,
          maxChars: BRIEF_LIMITS.lineChars,
        }).length === 0
      ) {
        items.push({ productId: candidate.id, name: candidate.name, line: pick.line });
      }
    }
    const usable = picks !== null;
    await this.settle(
      token,
      requestId,
      plan,
      result,
      'SUGGESTIONS',
      prepared.hash,
      usable ? { items } : null,
    );
    return {
      available: true,
      block: null,
      items,
      status: !usable ? 'UNAVAILABLE' : items.length > 0 ? 'READY' : 'NONE',
    };
  }

  /** The ledger row and the hold released together, then the result cached with the visit (nothing is cached when the call failed). */
  private async settle(
    token: string | undefined,
    requestId: string | undefined,
    plan: Plan<unknown>,
    result: GenerateResult | null,
    kind: 'BRIEF' | 'SUGGESTIONS',
    hash: string,
    payload: object | null,
  ): Promise<void> {
    await this.run(token, requestId, async (context) => {
      const { tx } = context;
      const feature = kind === 'BRIEF' ? 'BRIEF' : 'SUGGESTIONS';
      let cost = 0n;
      if (result !== null) {
        const model = isAiModel(result.modelUsed) ? result.modelUsed : plan.model;
        cost = costMicroUsd(model, result.usage);
        await writeLedger(
          tx,
          {
            feature,
            runId: null,
            itemId: null,
            model: result.modelUsed,
            outcome:
              result.outcome === 'REFUSED'
                ? 'REFUSED'
                : result.outcome === 'OK'
                  ? 'SUCCEEDED'
                  : 'FAILED',
            usage: result.usage,
            costMicroUsd: cost,
            requestId: result.requestId,
          },
          plan.reservationId,
        );
      } else if (plan.reservationId !== null) {
        await releaseReservation(tx, plan.reservationId);
      }
      if (payload !== null) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO ai_customer_briefs (visit_id, participant_id, kind, input_hash, payload, model, cost_micro_usd, expires_at)
          VALUES (${plan.access.visitId}::uuid, ${plan.access.participantId}::uuid, ${kind}, ${hash},
                  ${JSON.stringify(payload)}::jsonb, ${plan.model}, ${cost}, ${expiryOf(plan.access.serviceDate)}::timestamptz)
          ON CONFLICT (visit_id, participant_id, kind)
          DO UPDATE SET input_hash = EXCLUDED.input_hash, payload = EXCLUDED.payload, model = EXCLUDED.model,
                        cost_micro_usd = EXCLUDED.cost_micro_usd, created_at = clock_timestamp(), expires_at = EXCLUDED.expires_at`);
      }
    });
  }

  private run<T>(
    token: string | undefined,
    requestId: string | undefined,
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId },
      async (context) => {
        try {
          return await work(context);
        } catch (error) {
          if (error instanceof AuthError) throw error;
          const meta = Reflect.get(Object(error), 'meta');
          const state = sqlStateOf(error) ?? (meta ? Reflect.get(Object(meta), 'code') : undefined);
          if (
            ['55P03', '40P01', '40001', '23505', '23P01', '23514', '23503'].includes(state ?? '')
          ) {
            throw new AuthError('CONFLICT');
          }
          throw error;
        }
      },
    );
  }
}

function blockOf(settings: AiSettings, hasKey: boolean): BriefBlock | null {
  if (!settings.enabled) return 'AI_OFF';
  if (!settings.briefEnabled) return 'BRIEF_OFF';
  if (settings.vndPerUsd === null) return 'NO_RATE';
  if (!hasKey) return 'NO_KEY';
  return null;
}

/** The cached result of this kind for this visit participant, when it is still valid and was made from the same input. */
async function cachedPayload<T>(
  context: AdminContext,
  access: LineAccess,
  kind: 'BRIEF' | 'SUGGESTIONS',
  hash: string,
): Promise<T | null> {
  const rows = await context.tx.$queryRaw<{ payload: T; input_hash: string }[]>(Prisma.sql`
    SELECT payload, input_hash FROM ai_customer_briefs
     WHERE visit_id = ${access.visitId}::uuid AND participant_id = ${access.participantId}::uuid AND kind = ${kind}
       AND expires_at > clock_timestamp()`);
  const row = rows[0];
  return row !== undefined && row.input_hash === hash ? row.payload : null;
}
