import { parseRichText, validPageSlug, type WebsitePageRole } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import type { SessionPrincipal } from '../auth/session.policy.js';
import type { AdminContext } from '../authorization/admin-command.js';
import { decide, GLOBAL } from '../authorization/authorization.js';
import { loadAuthorityGraph } from '../authorization/authorization.store.js';
import { createPage } from './page.core.js';

/**
 * Redesign group 1, session 8: the Owner's eight policy pages (`docs/policies.md`, Vietnamese only, one per `## ` heading) as
 * published information pages. The wording is the Owner's and is never edited here. The addresses and roles are fixed below, in the
 * order of the file, so a reordered, renamed or missing heading stops the import instead of publishing the wrong text under an
 * address. Terms and privacy take their roles (the footer's legal line); the other six are policy pages. All eight list in the
 * footer's "Chính sách" column.
 */
export interface PolicyPageSpec {
  readonly heading: string;
  readonly slug: string;
  readonly role: WebsitePageRole;
}

export const POLICY_PAGES: readonly PolicyPageSpec[] = Object.freeze([
  { heading: 'Điều khoản sử dụng', slug: 'dieu-khoan-su-dung', role: 'TERMS' },
  { heading: 'Chính sách thanh toán', slug: 'chinh-sach-thanh-toan', role: 'POLICY' },
  { heading: 'Chính sách giao hàng', slug: 'chinh-sach-giao-hang', role: 'POLICY' },
  {
    heading: 'Chính sách đổi trả và hoàn tiền',
    slug: 'chinh-sach-doi-tra-hoan-tien',
    role: 'POLICY',
  },
  { heading: 'Chính sách bảo mật thông tin cá nhân', slug: 'chinh-sach-bao-mat', role: 'PRIVACY' },
  { heading: 'Chính sách đặt lịch dịch vụ', slug: 'chinh-sach-dat-lich', role: 'POLICY' },
  {
    heading: 'Chính sách thành viên và điểm thưởng',
    slug: 'chinh-sach-thanh-vien-diem-thuong',
    role: 'POLICY',
  },
  { heading: 'Tiếp nhận và giải quyết khiếu nại', slug: 'tiep-nhan-khieu-nai', role: 'POLICY' },
]);

export interface PolicyPage extends PolicyPageSpec {
  readonly body: string;
}

/** The pages of the file, or an error naming what is wrong. Nothing is rewritten: the body is the text under the heading. */
export function parsePolicyFile(markdown: string): PolicyPage[] {
  const lines = markdown.normalize('NFC').replace(/\r\n?/g, '\n').split('\n');
  const sections: { heading: string; lines: string[] }[] = [];
  for (const line of lines) {
    if (line.startsWith('## ')) sections.push({ heading: line.slice(3).trim(), lines: [] });
    else if (sections.length === 0) {
      if (line.trim() !== '') throw new Error('The file has text before the first "## " heading.');
    } else sections.at(-1)?.lines.push(line);
  }
  const found = sections.map((section) => section.heading);
  const expected = POLICY_PAGES.map((spec) => spec.heading);
  if (found.length !== expected.length || found.some((heading, i) => heading !== expected[i])) {
    throw new Error(
      `The headings of the file are not the eight expected pages, in order.\nExpected: ${expected.join(' | ')}\nFound:    ${found.join(' | ')}`,
    );
  }
  return POLICY_PAGES.map((spec, index) => {
    const body = (sections[index] as { lines: string[] }).lines
      .map((line) => line.replace(/[ \t]+$/g, ''))
      .join('\n')
      .trim();
    if (!validPageSlug(spec.slug)) throw new Error(`The address ${spec.slug} is not valid.`);
    const parsed = parseRichText(body);
    if (!parsed.ok) {
      throw new Error(
        `${spec.heading}: line ${parsed.line} breaks the page markup (${parsed.problem}).`,
      );
    }
    return { ...spec, body };
  });
}

export type PolicyImportOutcome =
  | { slug: string; status: 'created' | 'would-create' }
  | { slug: string; status: 'exists' }
  | { slug: string; status: 'blocked'; reason: string };

export type PolicyImportRun =
  { status: 'OK'; outcomes: PolicyImportOutcome[] } | { status: 'NO_ACTOR'; reason: string };

/**
 * One transaction of the one-time import. The pages belong to the Owner user (the only user of kind OWNER, or the one whose email is
 * given), who must be active and hold the website-content permission globally; the permission is checked from the authority graph,
 * as every admin command does. Run it inside a transaction that already holds the shared authorization-graph lock.
 */
export async function runPolicyImport(
  tx: Prisma.TransactionClient,
  options: { apply: boolean; pages: readonly PolicyPage[]; actorEmail?: string | undefined },
): Promise<PolicyImportRun> {
  const candidates = await tx.user.findMany({
    where:
      options.actorEmail === undefined
        ? { kind: 'OWNER' }
        : { emailCanonical: options.actorEmail.trim().toLowerCase() },
    select: { id: true, kind: true, status: true },
    take: 2,
  });
  if (candidates.length !== 1) {
    return {
      status: 'NO_ACTOR',
      reason:
        options.actorEmail === undefined
          ? 'Exactly one Owner user is needed, or pass --as=<sign-in email of the user who holds the website-content permission>.'
          : 'No user has that sign-in email.',
    };
  }
  const user = candidates[0] as { id: string; kind: string; status: string };
  const graph = await loadAuthorityGraph(tx, user.id);
  if (
    (user.kind !== 'OWNER' && user.kind !== 'EMPLOYEE') ||
    user.status !== 'ACTIVE' ||
    !graph ||
    !decide(graph, 'MANAGE_WEBSITE_CONTENT', GLOBAL)
  ) {
    return {
      status: 'NO_ACTOR',
      reason: 'That user is not an active staff user with the website-content permission.',
    };
  }
  const context: AdminContext = {
    tx,
    now: new Date(),
    // createPage reads only the user id and the graph; there is no session here.
    actor: {
      principal: {} as SessionPrincipal,
      graph,
      userId: user.id,
      owner: graph.kind === 'OWNER',
    },
    requestId: null,
  };
  return { status: 'OK', outcomes: await importPolicyPages(context, options.pages, options.apply) };
}

/**
 * Creates the pages that do not exist yet, in the file's order, through the same `createPage` the admin screen uses (the same
 * checks, lock and audit record). A page that exists (by address) is left exactly as it is. A terms or privacy page cannot be
 * published while another page already holds that role; that page is reported as blocked and nothing is written for it, so the
 * run never fails half way. Without `apply` it only reports.
 */
export async function importPolicyPages(
  context: AdminContext,
  pages: readonly PolicyPage[],
  apply: boolean,
): Promise<PolicyImportOutcome[]> {
  const tx = context.tx;
  const outcomes: PolicyImportOutcome[] = [];
  const takenRoles = new Map<WebsitePageRole, string>();
  for (const page of pages) {
    if (await tx.websitePage.findUnique({ where: { slug: page.slug }, select: { id: true } })) {
      outcomes.push({ slug: page.slug, status: 'exists' });
      continue;
    }
    if (page.role === 'TERMS' || page.role === 'PRIVACY') {
      const holder =
        takenRoles.get(page.role) ??
        (
          await tx.websitePage.findFirst({
            where: { role: page.role, isPublished: true },
            select: { slug: true },
          })
        )?.slug;
      if (holder) {
        outcomes.push({
          slug: page.slug,
          status: 'blocked',
          reason: `the ${page.role} page is already published at "${holder}"; unpublish it in the admin first`,
        });
        continue;
      }
      takenRoles.set(page.role, page.slug);
    }
    if (apply) {
      try {
        await createPage(context, {
          slug: page.slug,
          role: page.role,
          titleVi: page.heading,
          titleEn: null,
          bodyVi: page.body,
          bodyEn: null,
          seoTitleVi: null,
          seoTitleEn: null,
          seoDescriptionVi: null,
          seoDescriptionEn: null,
          isPublished: true,
        });
      } catch (error) {
        if (error instanceof AuthError) {
          throw new Error(`${page.slug}: the page was refused (${error.message}).`, {
            cause: error,
          });
        }
        throw error;
      }
    }
    outcomes.push({ slug: page.slug, status: apply ? 'created' : 'would-create' });
  }
  return outcomes;
}
