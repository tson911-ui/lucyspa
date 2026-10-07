import type { EngineCandidate, EngineResult } from './discount.engine.js';
import { evaluatePricingV3, type PricingV3Input, type PricingV3Result } from './pricing.v3.js';

/**
 * Phase 6 P6-9, OQ-59: the safety net of the new calculator. For an invoice with NO product line the version 2 engine stays the
 * source of truth; the version 3 engine runs beside it on the SAME already-loaded inputs (no extra query, no extra lock) and its
 * result is compared field by field. A difference, or a failure of version 3, is returned as data for the caller to log and
 * record; it never changes the charged amount and it never throws.
 */

export interface ShadowMismatch {
  /** A stable field name, e.g. `discountTotalVnd`, `spa.winnerSource`, `v3.error`. */
  field: string;
  v2: string;
  v3: string;
}

/** The engine under comparison; a test replaces it to force a difference or a failure (never done in production code). */
export const shadowControl: { evaluate: (input: PricingV3Input) => PricingV3Result } = {
  evaluate: evaluatePricingV3,
};

const text = (value: bigint | number | string | boolean | null | undefined): string =>
  value === null || value === undefined ? '-' : String(value);

function candidateSignature(candidate: EngineCandidate): string {
  return [
    candidate.program.id,
    candidate.voucher?.id ?? '-',
    candidate.eligible ? 'Y' : 'N',
    candidate.reason ?? '-',
    candidate.eligibleSubtotalVnd,
    candidate.amountVnd,
  ].join(':');
}

/** Every difference between the version 2 result of an invoice and the version 3 result of the same inputs. Empty = they agree. */
export function compareV2WithV3(v2: EngineResult, v3: PricingV3Result): ShadowMismatch[] {
  const out: ShadowMismatch[] = [];
  const check = (field: string, a: string, b: string) => {
    if (a !== b) out.push({ field, v2: a, v3: b });
  };
  const spa = v3.sides.SPA;
  check('subtotalVnd', text(v2.subtotalVnd), text(v3.subtotalVnd));
  check('discountTotalVnd', text(v2.discountTotalVnd), text(v3.discountTotalVnd));
  check('totalVnd', text(v2.totalVnd), text(v3.totalVnd));
  check('beautySide', 'absent', v3.sides.BEAUTY ? 'present' : 'absent');
  check('spa.winnerSource', text(v2.winnerSource), text(spa?.winnerSource));
  check('spa.winner.programId', text(v2.winner?.program.id), text(spa?.winner?.program.id));
  check('spa.winner.voucherId', text(v2.winner?.voucher?.id), text(spa?.winner?.voucher?.id));
  check('spa.winner.amountVnd', text(v2.winner?.amountVnd), text(spa?.winner?.amountVnd));
  check('spa.member.amountVnd', text(v2.member?.amountVnd), text(spa?.member?.amountVnd));
  check('spa.member.eligible', text(v2.member?.eligible), text(spa?.member?.eligible));
  check('spa.selectionReason', text(v2.selectionReason), text(spa?.selectionReason));
  check('spa.birthday.applied', text(v2.birthday?.applied), text(spa?.birthday?.applied));
  check('spa.birthday.amountVnd', text(v2.birthday?.amountVnd), text(spa?.birthday?.amountVnd));
  check('spa.birthday.baseVnd', text(v2.birthday?.baseVnd), text(spa?.birthday?.baseVnd));
  check('spa.birthday.mode', text(v2.birthday?.mode), text(spa?.birthday?.mode));
  check(
    'spa.candidates',
    v2.candidates.map(candidateSignature).join('|'),
    (spa?.candidates ?? []).map(candidateSignature).join('|'),
  );
  // The usage ledger: version 2 redeems its winning program once; version 3 must redeem exactly that program once.
  check(
    'redemptions',
    v2.winner ? `${v2.winner.program.id}:${v2.winner.voucher?.id ?? '-'}` : '-',
    v3.redemptions.map((r) => `${r.program.id}:${r.voucher?.id ?? '-'}`).join('|') || '-',
  );
  // The allocation must be exact: nets add up to the invoice total.
  const netSum = v3.allocations.reduce((sum, line) => sum + line.netVnd, 0n);
  check('allocations.netSum', text(v2.totalVnd), text(netSum));
  return out;
}

export interface ShadowOutcome {
  /** True when version 3 produced a result (even a differing one). */
  ran: boolean;
  mismatches: ShadowMismatch[];
}

/** Runs version 3 on the inputs of a version 2 evaluation and compares. NEVER throws and never alters `v2`. */
export function runShadow(v2: EngineResult, input: PricingV3Input): ShadowOutcome {
  try {
    const v3 = shadowControl.evaluate(input);
    return { ran: true, mismatches: compareV2WithV3(v2, v3) };
  } catch (error) {
    return {
      ran: false,
      mismatches: [
        {
          field: 'v3.error',
          v2: 'ok',
          v3: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : 'error',
        },
      ],
    };
  }
}
