import { randomUUID } from 'node:crypto';
import {
  ASSISTANT_LIMITS,
  type AssistantAnswer,
  type AssistantAskRequest,
  type AssistantBlock,
  type AssistantStatus,
} from '@lucy-spa/contracts';
import {
  ASSISTANT_SYSTEM,
  AiCallError,
  ClaudeClient,
  UNSURE_ANSWER,
  answerIsClean,
  buildAssistantUserMessage,
  checkAnswerNumbers,
  collectNumbers,
  costMicroUsd,
  isAiModel,
  loadAiSettings,
  maxCostMicroUsd,
  releaseReservation,
  reserveSpend,
  writeLedger,
  type AiModel,
  type AiSettings,
  type ConverseResult,
  type TokenUsage,
} from '@lucy-spa/server';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import {
  appendAdminAudit,
  runAdminCommand,
  type AdminContext,
} from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { ReportsService } from '../reports/reports.service.js';
import {
  definitionsOf,
  parseArgs,
  toolsFor,
  type AssistantReports,
  type AssistantTool,
  type ToolBranch,
} from './assistant.tools.js';

/**
 * Claude integration Wave C (CI-S1, design 7.1): the report assistant. A holder of `USE_AI_ASSISTANT` (GLOBAL) asks a question in plain
 * Vietnamese; Claude answers through a fixed catalogue of read-only tools that call the Phase 8 report services with the ASKER's own
 * token, so each report's permission and branch scope apply a second time. The tool list is filtered by the reports the person may open
 * before the call. The server then checks that every number of the answer came from a tool result; otherwise the answer is the fixed
 * "em chưa chắc chắn" sentence. The shop's money cap is reserved before the call and recorded after it (feature `ASSISTANT`); the question
 * and the answer are kept 30 days (the worker clears the text); the audit event holds the tools and the cost, never the text.
 */
const GLOBAL = { kind: 'GLOBAL' } as const;
/** The most one question may cost, held before the call: about 120K tokens in (the whole exchange is resent each round) and 14K out. */
const RESERVE_INPUT_TOKENS = 120_000;
const MAX_TOKENS = 2_000;
const RESERVE_OUTPUT_TOKENS = MAX_TOKENS * (ASSISTANT_LIMITS.toolCalls + 1);
const SHOP_ZONE = 'Asia/Ho_Chi_Minh';

export interface AssistantDependencies {
  client?: ClaudeClient;
  now?: () => Date;
}

interface Began {
  userId: string;
  settings: AiSettings;
  model: AiModel;
  reservationId: string;
}

interface ToolLogEntry {
  name: string;
  args: { from: string; to: string; branch: string | null } | null;
  ok: boolean;
}

@Injectable()
export class AssistantService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(ReportsService) private readonly reports: AssistantReports,
  ) {}

  /** The process environment (a test replaces it); only the key and the base URL are read from it. */
  env: NodeJS.ProcessEnv = process.env;
  private injected: AssistantDependencies = {};
  /** One question at a time per person: a second one while the first runs is refused. */
  private readonly busy = new Set<string>();

  use(dependencies: AssistantDependencies): this {
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

  private today(): string {
    const now = (this.injected.now ?? (() => new Date()))();
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: SHOP_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }

  status(token: string | undefined): Promise<AssistantStatus> {
    return this.run(token, undefined, async (context) => {
      requireAssistant(context);
      const settings = await loadAiSettings(context.tx);
      const block = blockOf(settings, this.client().hasKey);
      return {
        available: block === null,
        block,
        leftThisHour: Math.max(ASSISTANT_LIMITS.perHour - (await asked(context, 'hour')), 0),
      };
    });
  }

  async ask(
    token: string | undefined,
    body: AssistantAskRequest,
    requestId?: string,
  ): Promise<AssistantAnswer> {
    const question = cleanQuestion(body?.question);
    // Phase A: authority, switches, limits and the hold on the money, in one command.
    const began = await this.run(token, requestId, async (context) => {
      requireAssistant(context);
      const settings = await loadAiSettings(context.tx);
      if (blockOf(settings, this.client().hasKey) !== null || !isAiModel(settings.assistantModel)) {
        throw new AuthError('SERVICE_UNAVAILABLE', 'assistant');
      }
      if (
        (await asked(context, 'hour')) >= ASSISTANT_LIMITS.perHour ||
        (await asked(context, 'day')) >= ASSISTANT_LIMITS.perDay
      ) {
        throw new AuthError('RATE_LIMITED');
      }
      const model = settings.assistantModel;
      const reservation = await reserveSpend(context.tx, {
        feature: 'ASSISTANT',
        itemId: randomUUID(),
        amountMicroUsd: maxCostMicroUsd(model, RESERVE_INPUT_TOKENS, RESERVE_OUTPUT_TOKENS),
        settings,
        now: context.now,
      });
      if (!reservation.ok) throw new AuthError('SERVICE_UNAVAILABLE', 'cap');
      return {
        userId: context.actor.userId,
        settings,
        model,
        reservationId: reservation.reservationId,
      } satisfies Began;
    });
    if (this.busy.has(began.userId)) {
      await this.run(token, requestId, (context) =>
        releaseReservation(context.tx, began.reservationId),
      );
      throw new AuthError('RATE_LIMITED');
    }
    this.busy.add(began.userId);
    try {
      return await this.answer(token, requestId, question, began);
    } finally {
      this.busy.delete(began.userId);
    }
  }

  private async answer(
    token: string | undefined,
    requestId: string | undefined,
    question: string,
    began: Began,
  ): Promise<AssistantAnswer> {
    const log: ToolLogEntry[] = [];
    const reportsUsed = new Set<string>();
    const periods: { from: string; to: string }[] = [];
    const allowed = new Set<number>();
    let outcome: ConverseResult | null = null;
    let failure: AiCallError | null = null;
    let unavailable = false;
    try {
      const registry = await this.reports.registry(token);
      const { tools, branches } = toolsFor(registry);
      if (tools.length === 0) {
        unavailable = true;
      } else {
        outcome = await this.client().converse({
          model: began.model,
          effort: 'low',
          system: ASSISTANT_SYSTEM,
          user: buildAssistantUserMessage(question, this.today()),
          tools: definitionsOf(tools, branches),
          maxTokens: MAX_TOKENS,
          timeoutMs: ASSISTANT_LIMITS.timeoutMs,
          maxToolCalls: ASSISTANT_LIMITS.toolCalls,
          refusalFallback: began.settings.refusalFallback,
          runTool: async (call) =>
            this.runTool(
              call.name,
              call.input,
              { token, tools, branches },
              {
                log,
                reportsUsed,
                periods,
                allowed,
              },
            ),
        });
      }
    } catch (error) {
      if (error instanceof AiCallError) failure = error;
      else if (error instanceof AuthError) {
        // The person lost the right while the question ran: nothing is answered, nothing was billed.
        await this.finish(
          token,
          requestId,
          began,
          question,
          null,
          null,
          log,
          'FAILED',
          'FORBIDDEN',
        );
        throw error;
      } else {
        failure = new AiCallError('UNREACHABLE');
      }
    }

    if (failure !== null) {
      // Nothing was billed: the hold is released and the question is logged as failed.
      await this.finish(token, requestId, began, question, null, null, log, 'FAILED', failure.code);
      throw new AuthError(failure.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE');
    }

    let status: 'ANSWERED' | 'UNSURE' | 'REFUSED' = 'UNSURE';
    let answer = UNSURE_ANSWER;
    let errorCode: string | null = unavailable ? 'NO_REPORTS' : null;
    if (outcome !== null) {
      if (outcome.outcome === 'REFUSED') {
        status = 'REFUSED';
        errorCode = 'REFUSED';
      } else if (outcome.outcome === 'OK') {
        const text = outcome.text.trim();
        const checked = checkAnswerNumbers(text, allowed, question);
        if (text !== '' && answerIsClean(text) && checked.ok) {
          status = 'ANSWERED';
          answer = text;
        } else {
          errorCode = text === '' ? 'EMPTY' : checked.ok ? 'UNCLEAN' : 'NUMBERS';
        }
      } else {
        errorCode = outcome.outcome;
      }
    }
    await this.finish(token, requestId, began, question, outcome, answer, log, status, errorCode);
    return {
      status: status === 'ANSWERED' ? 'ANSWERED' : 'UNSURE',
      answer,
      reports: [...reportsUsed],
      periods,
    };
  }

  /** One tool call: validated, run with the asker's token, projected, and its numbers added to what the answer may quote. */
  private async runTool(
    name: string,
    input: unknown,
    scope: { token: string | undefined; tools: AssistantTool[]; branches: ToolBranch[] },
    sink: {
      log: ToolLogEntry[];
      reportsUsed: Set<string>;
      periods: { from: string; to: string }[];
      allowed: Set<number>;
    },
  ): Promise<string> {
    const tool = scope.tools.find((entry) => entry.name === name);
    if (tool === undefined) {
      sink.log.push({ name, args: null, ok: false });
      return JSON.stringify({ error: 'This tool is not available to you.' });
    }
    const args = parseArgs(input, scope.branches);
    if (args === null) {
      sink.log.push({ name, args: null, ok: false });
      return JSON.stringify({
        error:
          'Invalid arguments: use real dates (YYYY-MM-DD), from not after to, at most 366 days, and a branch code from the list or null.',
      });
    }
    const branchCode = args.branchId
      ? (scope.branches.find((branch) => branch.id === args.branchId)?.code ?? null)
      : null;
    try {
      if (scope.token === undefined) throw new AuthError('AUTHENTICATION_REQUIRED');
      const result = await tool.run(args, {
        token: scope.token,
        reports: this.reports,
        branches: scope.branches,
      });
      collectNumbers(result, sink.allowed);
      // The dates the call used are part of what the answer may say.
      collectNumbers({ from: args.from, to: args.to }, sink.allowed);
      sink.reportsUsed.add(tool.reportId);
      sink.periods.push({ from: args.from, to: args.to });
      sink.log.push({ name, args: { from: args.from, to: args.to, branch: branchCode }, ok: true });
      return JSON.stringify(result);
    } catch (error) {
      sink.log.push({
        name,
        args: { from: args.from, to: args.to, branch: branchCode },
        ok: false,
      });
      return JSON.stringify({
        error:
          error instanceof AuthError && error.getStatus() === 403
            ? 'This report is not available to you.'
            : 'The report could not be read right now.',
      });
    }
  }

  /** Phase C: the ledger row and the hold released together, the question row, the audit event. */
  private finish(
    token: string | undefined,
    requestId: string | undefined,
    began: Began,
    question: string,
    result: ConverseResult | null,
    answer: string | null,
    log: ToolLogEntry[],
    status: 'ANSWERED' | 'UNSURE' | 'REFUSED' | 'FAILED',
    errorCode: string | null,
  ): Promise<void> {
    return this.run(token, requestId, async (context) => {
      const { tx } = context;
      const usage: TokenUsage = result?.usage ?? {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
      };
      const billed = result !== null && result.requests > 0;
      const model = result?.modelUsed ?? began.model;
      const cost = billed ? costMicroUsd(isAiModel(model) ? model : began.model, usage) : 0n;
      if (billed) {
        await writeLedger(
          tx,
          {
            feature: 'ASSISTANT',
            runId: null,
            itemId: null,
            model,
            outcome: status === 'REFUSED' ? 'REFUSED' : 'SUCCEEDED',
            usage,
            costMicroUsd: cost,
            requestId: result.requestId,
          },
          began.reservationId,
        );
      } else {
        await releaseReservation(tx, began.reservationId);
      }
      const id = randomUUID();
      await tx.aiAssistantQuestion.create({
        data: {
          id,
          userId: context.actor.userId,
          status,
          question,
          answer: status === 'FAILED' ? null : answer,
          tools: log as unknown as object,
          model,
          requests: result?.requests ?? 0,
          costMicroUsd: cost,
          errorCode,
        },
      });
      await appendAdminAudit(context, {
        action: 'AI_ASSISTANT_QUESTION',
        entityType: 'AiAssistantQuestion',
        entityId: id,
        after: {
          status,
          model,
          requests: result?.requests ?? 0,
          costMicroUsd: cost.toString(),
          tools: log,
          errorCode,
        } as unknown as object,
      });
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

function requireAssistant(context: AdminContext): void {
  if (!decide(context.actor.graph, 'USE_AI_ASSISTANT', GLOBAL)) throw new AuthError('FORBIDDEN');
}

export function blockOf(settings: AiSettings, hasKey: boolean): AssistantBlock | null {
  if (!settings.enabled) return 'AI_OFF';
  if (!settings.assistantEnabled) return 'ASSISTANT_OFF';
  if (settings.vndPerUsd === null) return 'NO_RATE';
  if (!hasKey) return 'NO_KEY';
  return null;
}

/** The question as stored and sent: trimmed, one to 300 characters, no control characters. */
function cleanQuestion(value: unknown): string {
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', 'question');
  const text = value.replace(/\r\n?/g, '\n').normalize('NFC').trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new AuthError('VALIDATION_FAILED', 'question');
  }
  if (text === '' || [...text].length > ASSISTANT_LIMITS.questionMax) {
    throw new AuthError('VALIDATION_FAILED', 'question');
  }
  return text;
}

/** How many questions this person asked in the last hour or day (failed ones count: they cost a call or a hold). */
async function asked(context: AdminContext, window: 'hour' | 'day'): Promise<number> {
  const since = new Date(context.now.getTime() - (window === 'hour' ? 3_600_000 : 86_400_000));
  return context.tx.aiAssistantQuestion.count({
    where: { userId: context.actor.userId, createdAt: { gte: since } },
  });
}
