import type {
  BranchSummary,
  CurrentAccountResponse,
  VisitParticipantKindName,
  WalkInCreateRequest,
  WalkInWaitReason,
} from '@lucy-spa/contracts';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { canAt } from './permissions';

/**
 * Walk-in intake draft (Phase 3 Step 6). The browser only collects who came and what they want;
 * arrival time, KTV assignment, planned times and capacity are decided by the server.
 */
export interface WalkInPerson {
  key: string;
  kind: VisitParticipantKindName;
  /** MEMBER only: the existing account chosen from the exact-match lookup. */
  customerUserId?: string;
  /** MEMBER: the name shown by the lookup (display only); GUEST/CHILD: the name to call. */
  displayName: string;
  phone: string;
  /** CHILD only: the adult participant's key. */
  guardianKey?: string;
}

export interface WalkInLine {
  key: string;
  participantKey: string;
  serviceId: string;
  /** 'ANY' or a requested KTV id. */
  staff: string;
}

/** Branches where this account may take walk-ins (the API decides again on every call). */
export function walkInBranches(
  account: CurrentAccountResponse,
  branches: ReadonlyMap<string, BranchSummary> | null,
): BranchSummary[] {
  return [...(branches?.values() ?? [])]
    .filter((branch) => branch.isActive && canAt(account, 'MANAGE_BOOKINGS', branch.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

/** Adults who can accompany a child. */
export function guardians(people: readonly WalkInPerson[]): WalkInPerson[] {
  return people.filter((person) => person.kind !== 'CHILD');
}

export function walkInProblem(
  people: readonly WalkInPerson[],
  lines: readonly WalkInLine[],
): 'people' | 'name' | 'guardian' | null {
  if (people.length === 0 || lines.filter((line) => line.serviceId).length === 0) return 'people';
  if (people.some((person) => person.kind !== 'MEMBER' && !person.displayName.trim()))
    return 'name';
  const adults = new Set(guardians(people).map((person) => person.key));
  if (people.some((person) => person.kind === 'CHILD' && !adults.has(person.guardianKey ?? ''))) {
    return 'guardian';
  }
  return null;
}

/** The request: members by account id only; guests and children by name; never an account. */
export function walkInRequest(
  people: readonly WalkInPerson[],
  lines: readonly WalkInLine[],
  idempotencyKey: string,
): WalkInCreateRequest {
  return {
    idempotencyKey,
    participants: people.map((person) =>
      person.kind === 'MEMBER'
        ? { key: person.key, kind: 'MEMBER' as const, customerUserId: person.customerUserId ?? '' }
        : {
            key: person.key,
            kind: person.kind,
            displayName: person.displayName.trim(),
            ...(person.phone.trim() ? { phone: person.phone.trim() } : {}),
            ...(person.kind === 'CHILD' ? { guardianKey: person.guardianKey ?? '' } : {}),
          },
    ),
    lines: lines
      .filter((line) => line.serviceId)
      .map((line) => ({
        participantKey: line.participantKey,
        serviceId: line.serviceId,
        requestedEmployeeUserId: line.staff === 'ANY' ? null : line.staff,
      })),
  };
}

export function waitReasonText(reason: WalkInWaitReason | null, t: WorkforceDictionary): string {
  return reason ? t.walkIn.waitReasons[reason] : t.walkIn.waitReasons.NO_CAPACITY;
}

/** The cancellation body: a reason is required (1–500 characters after trimming). */
export function walkInCancelBody(reason: string): { reason: string } | null {
  const trimmed = reason.normalize('NFC').trim();
  return trimmed && [...trimmed].length <= 500 ? { reason: trimmed } : null;
}
