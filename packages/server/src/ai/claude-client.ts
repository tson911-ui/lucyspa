import Anthropic from '@anthropic-ai/sdk';
import { isAiModel, type AiEffort, type AiModel, type TokenUsage } from './prices.js';

/**
 * Claude integration Wave A (CI-X2): the one place that talks to Anthropic. A thin wrapper over the official SDK: Messages API, streaming
 * with the final message (long outputs, no HTTP timeout surprises), adaptive thinking (omitted: it is the default of the models used and
 * `{type:"disabled"}` is rejected by them), `output_config.effort`, a strict JSON schema answer, **no tools and no web**, no temperature or
 * prefill (rejected by these models). The key is read by the caller from its environment and handed in; it is never logged, stored or
 * put in an error (errors are a code and an HTTP status only, the repo's style).
 *
 * Failures are classified so a run can react: money errors and a bad key pause everything and are never retried, rate and server errors
 * are retried by the caller with back-off, a refusal or a cut-off answer is a normal outcome that is still billed and still recorded.
 */

export type AiErrorCode =
  | 'KEY_MISSING'
  | 'AUTH_FAILED'
  | 'SPEND_LIMIT'
  | 'RATE_LIMITED'
  | 'SERVER'
  | 'UNREACHABLE'
  | 'TIMEOUT'
  | 'BAD_REQUEST';

export class AiCallError extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly status: number | null = null,
    readonly requestId: string | null = null,
  ) {
    super(code);
    this.name = 'AiCallError';
  }

  /** A retry later can help. */
  get retryable(): boolean {
    return (
      this.code === 'RATE_LIMITED' ||
      this.code === 'SERVER' ||
      this.code === 'UNREACHABLE' ||
      this.code === 'TIMEOUT'
    );
  }

  /** Nothing can be called until a person acts (the key, or the Owner's own spending limit). */
  get blocksEverything(): boolean {
    return (
      this.code === 'KEY_MISSING' || this.code === 'AUTH_FAILED' || this.code === 'SPEND_LIMIT'
    );
  }
}

export interface GenerateRequest {
  model: AiModel;
  effort: AiEffort;
  system: string;
  user: string;
  /** JSON schema of the answer (`output_config.format`). */
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
  /** Server-side refusal fallback (Anthropic's own setting for these models; the Owner can switch it off). */
  refusalFallback: boolean;
}

export type GenerateOutcome = 'OK' | 'REFUSED' | 'MAX_TOKENS' | 'INVALID_JSON';

export interface GenerateResult {
  outcome: GenerateOutcome;
  /** The parsed answer when `outcome` is OK. */
  json: unknown;
  usage: TokenUsage;
  requestId: string | null;
  /** The model that answered (a fallback model after a refusal). */
  modelUsed: string;
  stopReason: string | null;
}

export interface ClaudeClientOptions {
  apiKey: string | undefined;
  /** Tests point this at the fake; production leaves it unset. */
  baseUrl?: string | undefined;
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** The fields of a finished message this client reads (the SDK's own types are wider and differ between the beta and the plain call). */
interface FinalMessage {
  model: string;
  stop_reason: string | null;
  content: { type: string; text?: string }[];
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
  _request_id?: string | null;
}

function codeOf(error: unknown): AiCallError {
  if (error instanceof AiCallError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiCallError('TIMEOUT');
  if (error instanceof Anthropic.APIConnectionError) return new AiCallError('UNREACHABLE');
  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === 'number' ? error.status : null;
    const requestId = error.requestID ?? null;
    const body: unknown = error.error;
    const inner =
      typeof body === 'object' && body !== null
        ? (Reflect.get(body, 'error') as unknown)
        : undefined;
    const message =
      typeof inner === 'object' && inner !== null
        ? String(Reflect.get(inner, 'message') ?? '')
        : '';
    const details =
      typeof inner === 'object' && inner !== null ? Reflect.get(inner, 'details') : undefined;
    const detailCode =
      typeof details === 'object' && details !== null
        ? String(Reflect.get(details, 'error_code') ?? '')
        : '';
    // The Owner's own Console spend limit answers 400, the tier cap answers 429 with its own error code and no retry-after.
    if (status === 400 && /usage limits|spend limit|credit balance/i.test(message)) {
      return new AiCallError('SPEND_LIMIT', status, requestId);
    }
    if (status === 429 && detailCode === 'enforced_spend_limit_reached') {
      return new AiCallError('SPEND_LIMIT', status, requestId);
    }
    if (status === 401 || status === 403) return new AiCallError('AUTH_FAILED', status, requestId);
    if (status === 429) return new AiCallError('RATE_LIMITED', status, requestId);
    if (status !== null && status >= 500) return new AiCallError('SERVER', status, requestId);
    return new AiCallError('BAD_REQUEST', status, requestId);
  }
  return new AiCallError('UNREACHABLE');
}

/** The text of an answer; a code fence around the JSON (some models add one) is removed. */
function parseJson(text: string): unknown {
  const body = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

export class ClaudeClient {
  private readonly client: Anthropic | null;

  constructor(options: ClaudeClientOptions) {
    this.client = options.apiKey
      ? new Anthropic({
          apiKey: options.apiKey,
          ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
          // Retries are the caller's (per item, with a ledger row for every billed attempt); the SDK only retries what is safe.
          maxRetries: 1,
        })
      : null;
  }

  get hasKey(): boolean {
    return this.client !== null;
  }

  /** A free call that proves the key is accepted and the server can reach Anthropic (lists one model; nothing is billed). */
  async checkConnection(timeoutMs = 15_000): Promise<void> {
    if (this.client === null) throw new AiCallError('KEY_MISSING');
    try {
      await this.client.models.list({ limit: 1 }, { timeout: timeoutMs });
    } catch (error) {
      throw codeOf(error);
    }
  }

  async generateJson(request: GenerateRequest): Promise<GenerateResult> {
    if (this.client === null) throw new AiCallError('KEY_MISSING');
    const params = {
      model: request.model,
      max_tokens: request.maxTokens,
      system: [
        {
          type: 'text' as const,
          text: request.system,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: request.user }],
      output_config: {
        effort: request.effort,
        format: { type: 'json_schema' as const, schema: request.schema },
      },
    };
    try {
      // The beta and the plain message types differ in their block unions; the few fields read here are the same, so one narrow shape is used.
      const stream = request.refusalFallback
        ? this.client.beta.messages.stream(
            { ...params, betas: [FALLBACK_BETA], fallbacks: 'default' } as never,
            { timeout: request.timeoutMs },
          )
        : this.client.messages.stream(params as never, { timeout: request.timeoutMs });
      const message = (await stream.finalMessage()) as unknown as FinalMessage;
      message._request_id = stream.request_id ?? null;
      const usage: TokenUsage = {
        inputTokens: message.usage.input_tokens ?? 0,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        outputTokens: message.usage.output_tokens ?? 0,
      };
      const modelUsed = typeof message.model === 'string' ? message.model : request.model;
      const requestId = message._request_id ?? null;
      const base = {
        usage,
        requestId,
        modelUsed: isAiModel(modelUsed) ? modelUsed : String(modelUsed),
        stopReason: message.stop_reason ?? null,
      };
      if (message.stop_reason === 'refusal') return { ...base, outcome: 'REFUSED', json: null };
      const text = message.content
        .map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
        .join('');
      if (message.stop_reason === 'max_tokens')
        return { ...base, outcome: 'MAX_TOKENS', json: null };
      const json = parseJson(text);
      if (json === undefined) return { ...base, outcome: 'INVALID_JSON', json: null };
      return { ...base, outcome: 'OK', json };
    } catch (error) {
      throw codeOf(error);
    }
  }
}
