import type { Prisma } from '@lucy-spa/database';
import { canSupervise, loadAuthorityGraph, type AuthorityGraph } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
/** Adds hierarchy/team containment; never replaces the operation's permission check. */
export async function requireSupervision(
  tx: Prisma.TransactionClient,
  actor: AuthorityGraph,
  targetId: string,
  branches?: readonly string[],
): Promise<void> {
  const target = await loadAuthorityGraph(tx, targetId);
  if (!target || !canSupervise(actor, target, branches)) throw new AuthError('FORBIDDEN');
}
export function scopeBranchIds(graph: AuthorityGraph): string[] {
  return [
    ...new Set([
      ...graph.activeBranchIds,
      ...(graph.organization?.branches.map((branch) => branch.id) ?? []),
    ]),
  ];
}
