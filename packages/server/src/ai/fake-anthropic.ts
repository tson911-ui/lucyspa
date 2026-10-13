import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

/**
 * Claude integration Wave A: a small fake of `POST /v1/messages` (server-sent events) for the tests of the client, the rewrite engine, the
 * worker and the API. No test ever contacts Anthropic. Replies are queued; every request (path, headers, body) is kept so a test can assert
 * what was sent (the key header, the model, no `temperature`, the schema, the delimited user block).
 */
export type FakeReply =
  | {
      kind: 'message';
      /** The text of the single text block (a JSON string for the rewrite). */
      text: string;
      model?: string;
      stopReason?: 'end_turn' | 'max_tokens' | 'refusal' | 'tool_use';
      /** Tool calls the model makes in this turn (Wave C); the stop reason becomes `tool_use` unless set. */
      toolUses?: { id: string; name: string; input: unknown }[];
      usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
      /** Sent as the `request-id` header. */
      requestId?: string;
      /** Milliseconds to wait before answering (timeouts, concurrency). */
      delayMs?: number;
    }
  | {
      kind: 'error';
      status: number;
      type?: string;
      message?: string;
      headers?: Record<string, string>;
      /** Extra fields of the error object (for example `details`). */
      error?: Record<string, unknown>;
    }
  | { kind: 'hang' }
  | { kind: 'drop' };

export interface FakeRequest {
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });

const sse = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export class FakeAnthropic {
  readonly requests: FakeRequest[] = [];
  /** Used when the queue is empty. */
  fallback: FakeReply | null = null;
  private readonly queue: FakeReply[] = [];
  private server: Server | null = null;
  private readonly open = new Set<Socket>();
  /** How many requests are being answered right now, and the most at once (concurrency tests). */
  inFlight = 0;
  maxInFlight = 0;

  enqueue(...replies: FakeReply[]): this {
    this.queue.push(...replies);
    return this;
  }

  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server.on('connection', (socket) => {
      this.open.add(socket);
      socket.on('close', () => this.open.delete(socket));
    });
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    for (const socket of this.open) socket.destroy();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const raw = await readBody(request);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      body = {};
    }
    this.requests.push({ path: request.url ?? '', headers: request.headers, body });
    const reply = this.queue.shift() ?? this.fallback;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (reply === null) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'api_error', message: 'no reply queued' },
          }),
        );
        return;
      }
      if (reply.kind === 'hang') return await new Promise<void>(() => undefined);
      if ((request.url ?? '').startsWith('/v1/models') && reply.kind === 'message') {
        // The free key check lists one model.
        response.writeHead(200, {
          'content-type': 'application/json',
          'request-id': 'req_fake_models',
        });
        response.end(JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }));
        return;
      }
      if (reply.kind === 'drop') {
        request.socket.destroy();
        return;
      }
      if (reply.kind === 'error') {
        response.writeHead(reply.status, {
          'content-type': 'application/json',
          'request-id': 'req_fake_error',
          ...(reply.headers ?? {}),
        });
        response.end(
          JSON.stringify({
            type: 'error',
            error: {
              type: reply.type ?? 'api_error',
              message: reply.message ?? 'fake error',
              ...(reply.error ?? {}),
            },
          }),
        );
        return;
      }
      if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
      const model = reply.model ?? (typeof body['model'] === 'string' ? body['model'] : 'fake');
      const usage = reply.usage ?? {};
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'request-id': reply.requestId ?? 'req_fake_ok',
      });
      response.write(
        sse('message_start', {
          type: 'message_start',
          message: {
            id: 'msg_fake',
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: usage.input ?? 100,
              output_tokens: 1,
              cache_read_input_tokens: usage.cacheRead ?? 0,
              cache_creation_input_tokens: usage.cacheWrite ?? 0,
            },
          },
        }),
      );
      const toolUses = reply.toolUses ?? [];
      const stopReason = reply.stopReason ?? (toolUses.length > 0 ? 'tool_use' : 'end_turn');
      if (reply.stopReason !== 'refusal' && (reply.text !== '' || toolUses.length === 0)) {
        response.write(
          sse('content_block_start', {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          }),
        );
        // Two deltas, so the client really assembles a stream.
        const middle = Math.floor(reply.text.length / 2);
        for (const piece of [reply.text.slice(0, middle), reply.text.slice(middle)]) {
          response.write(
            sse('content_block_delta', {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: piece },
            }),
          );
        }
        response.write(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
      }
      if (reply.stopReason !== 'refusal') {
        toolUses.forEach((use, at) => {
          const index = at + 1;
          response.write(
            sse('content_block_start', {
              type: 'content_block_start',
              index,
              content_block: { type: 'tool_use', id: use.id, name: use.name, input: {} },
            }),
          );
          response.write(
            sse('content_block_delta', {
              type: 'content_block_delta',
              index,
              delta: { type: 'input_json_delta', partial_json: JSON.stringify(use.input) },
            }),
          );
          response.write(sse('content_block_stop', { type: 'content_block_stop', index }));
        });
      }
      response.write(
        sse('message_delta', {
          type: 'message_delta',
          delta: {
            stop_reason: stopReason,
            stop_sequence: null,
            ...(reply.stopReason === 'refusal'
              ? {
                  stop_details: { type: 'refusal', category: 'general_harms', explanation: 'fake' },
                }
              : {}),
          },
          usage: { output_tokens: usage.output ?? 50 },
        }),
      );
      response.end(sse('message_stop', { type: 'message_stop' }));
    } finally {
      this.inFlight -= 1;
    }
  }
}
