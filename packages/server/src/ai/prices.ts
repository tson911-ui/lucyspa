/**
 * Claude integration Wave A (CI-X2): what a call costs. Prices are Anthropic's published USD per million tokens (checked on
 * 2026-10-12, `platform.claude.com/docs/en/about-claude/pricing`); the ledger stores tokens as well as dollars, so a price change never
 * makes history unreadable. Money here is **micro-USD** (1 USD = 1,000,000), an integer; a price in USD per million tokens is exactly
 * "micro-USD per token", so cost = tokens x price. The few fractional prices (cache reads of the cheapest model) are kept in hundredths
 * of a micro-USD, and a cost is always rounded UP, so the ledger never under-counts.
 */

export const PRICE_TABLE_DATE = '2026-10-12';

/** The models the Owner may choose for the rewrite (allow-list; the database CHECK holds the same three). */
export const AI_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
export type AiModel = (typeof AI_MODELS)[number];

export const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

export const isAiModel = (value: unknown): value is AiModel =>
  typeof value === 'string' && (AI_MODELS as readonly string[]).includes(value);
export const isAiEffort = (value: unknown): value is AiEffort =>
  typeof value === 'string' && (AI_EFFORTS as readonly string[]).includes(value);

/** Hundredths of a micro-USD per token (= hundredths of USD per million tokens). */
interface Price {
  input: bigint;
  output: bigint;
  cacheRead: bigint;
  /** Writing a 5-minute cache entry (1.25 x input). */
  cacheWrite: bigint;
}

const PRICES: Record<AiModel, Price> = {
  // 4 / 20 USD; cache read 0.20; 5-minute cache write 5.
  'claude-opus-5-5': { input: 400n, output: 2000n, cacheRead: 20n, cacheWrite: 500n },
  // 2 / 10 USD; cache read 0.10; 5-minute cache write 2.50.
  'claude-sonnet-5-5': { input: 200n, output: 1000n, cacheRead: 10n, cacheWrite: 250n },
  // 0.10 / 0.50 USD for prompts up to 100K tokens; cache read 0.01; cache write 0.125 (rounded up to 0.13).
  'claude-haiku-5-5': { input: 10n, output: 50n, cacheRead: 1n, cacheWrite: 13n },
};

export interface TokenUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

const ceilDiv100 = (value: bigint): bigint => (value + 99n) / 100n;

/** The cost of the tokens of one call in micro-USD, rounded up. An unknown model id costs as the most expensive one (never under-counts). */
export function costMicroUsd(model: string, usage: TokenUsage): bigint {
  const price = isAiModel(model) ? PRICES[model] : PRICES['claude-opus-5-5'];
  const total =
    BigInt(usage.inputTokens) * price.input +
    BigInt(usage.cacheReadTokens) * price.cacheRead +
    BigInt(usage.cacheWriteTokens) * price.cacheWrite +
    BigInt(usage.outputTokens) * price.output;
  return ceilDiv100(total);
}

/**
 * The most a call can cost, reserved before it is made: every input token at the full price (cache hits can only make it cheaper) plus
 * `maxTokens` of output (thinking tokens count as output and are bounded by `max_tokens`).
 */
export function maxCostMicroUsd(model: string, inputTokens: number, maxTokens: number): bigint {
  return costMicroUsd(model, {
    inputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: maxTokens,
  });
}

/** VND -> micro-USD at the rate the Owner typed (VND per USD): `vnd * 1e6 / rate`, rounded down (a cap never grows by rounding). */
export function vndToMicroUsd(vnd: bigint, vndPerUsd: number): bigint {
  if (!Number.isInteger(vndPerUsd) || vndPerUsd <= 0) throw new RangeError('vndPerUsd');
  return (vnd * 1_000_000n) / BigInt(vndPerUsd);
}

/** micro-USD -> VND, rounded up (what the Owner reads as spent is never lower than the truth). */
export function microUsdToVnd(micro: bigint, vndPerUsd: number): bigint {
  if (!Number.isInteger(vndPerUsd) || vndPerUsd <= 0) throw new RangeError('vndPerUsd');
  return (micro * BigInt(vndPerUsd) + 999_999n) / 1_000_000n;
}
