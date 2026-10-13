import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  AiCallError,
  ClaudeClient,
  type ConverseRequest,
  type GenerateRequest,
} from './claude-client.js';
import { FakeAnthropic } from './fake-anthropic.js';

const fake = new FakeAnthropic();
let baseUrl = '';
before(async () => {
  baseUrl = await fake.start();
});
after(async () => {
  await fake.stop();
});

const KEY = 'sk-ant-test-key-never-real';
const request = (patch: Partial<GenerateRequest> = {}): GenerateRequest => ({
  model: 'claude-opus-5-5',
  effort: 'medium',
  system: 'SYSTEM PROMPT',
  user: 'USER MESSAGE',
  schema: {
    type: 'object',
    properties: { a: { type: 'string' } },
    required: ['a'],
    additionalProperties: false,
  },
  maxTokens: 4000,
  timeoutMs: 5000,
  refusalFallback: false,
  ...patch,
});
const client = () => new ClaudeClient({ apiKey: KEY, baseUrl });
const reset = () => {
  fake.requests.length = 0;
  fake.fallback = null;
};

test('a call: key header, model, effort, strict JSON schema, streamed, no temperature and no tools; usage and answer read back', async () => {
  reset();
  fake.enqueue({
    kind: 'message',
    text: '{"a":"xin chào"}',
    usage: { input: 1200, output: 340, cacheRead: 2500, cacheWrite: 10 },
    requestId: 'req_test_1',
  });
  const result = await client().generateJson(request());
  assert.equal(result.outcome, 'OK');
  assert.deepEqual(result.json, { a: 'xin chào' });
  assert.deepEqual(result.usage, {
    inputTokens: 1200,
    cacheReadTokens: 2500,
    cacheWriteTokens: 10,
    outputTokens: 340,
  });
  assert.equal(result.requestId, 'req_test_1');
  assert.equal(result.modelUsed, 'claude-opus-5-5');
  const sent = fake.requests[0]!;
  assert.equal(sent.path.split('?')[0], '/v1/messages');
  assert.equal(sent.headers['x-api-key'], KEY);
  assert.equal(sent.body['model'], 'claude-opus-5-5');
  assert.equal(sent.body['stream'], true);
  assert.equal(sent.body['max_tokens'], 4000);
  for (const forbidden of ['temperature', 'top_p', 'top_k', 'tools', 'tool_choice', 'thinking']) {
    assert.ok(!(forbidden in sent.body), `${forbidden} is not sent`);
  }
  const config = sent.body['output_config'] as {
    effort: string;
    format: { type: string; schema: unknown };
  };
  assert.equal(config.effort, 'medium');
  assert.equal(config.format.type, 'json_schema');
  assert.deepEqual(sent.body['messages'], [{ role: 'user', content: 'USER MESSAGE' }]);
  assert.match(JSON.stringify(sent.body['system']), /SYSTEM PROMPT/);
});

test('refusal fallback: the beta header and the "default" form are sent only when asked', async () => {
  reset();
  fake.enqueue({ kind: 'message', text: '{"a":"x"}' }, { kind: 'message', text: '{"a":"x"}' });
  await client().generateJson(request({ refusalFallback: true }));
  const on = fake.requests[0]!;
  assert.match(String(on.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
  assert.equal(on.body['fallbacks'], 'default');
  await client().generateJson(request({ refusalFallback: false }));
  const off = fake.requests[1]!;
  assert.ok(!('fallbacks' in off.body));
  assert.ok(!String(off.headers['anthropic-beta'] ?? '').includes('server-side-fallback'));
});

test('a refusal and a cut-off answer are normal outcomes that carry their usage (they are still billed)', async () => {
  reset();
  fake.enqueue(
    { kind: 'message', text: '', stopReason: 'refusal', usage: { input: 900, output: 5 } },
    {
      kind: 'message',
      text: '{"a":"tr',
      stopReason: 'max_tokens',
      usage: { input: 900, output: 4000 },
    },
    { kind: 'message', text: 'not json at all', usage: { input: 10, output: 10 } },
    { kind: 'message', text: '```json\n{"a":"fenced"}\n```' },
  );
  const refused = await client().generateJson(request());
  assert.equal(refused.outcome, 'REFUSED');
  assert.equal(refused.usage.inputTokens, 900);
  const cut = await client().generateJson(request());
  assert.equal(cut.outcome, 'MAX_TOKENS');
  assert.equal(cut.usage.outputTokens, 4000);
  const broken = await client().generateJson(request());
  assert.equal(broken.outcome, 'INVALID_JSON');
  const fenced = await client().generateJson(request());
  assert.equal(fenced.outcome, 'OK');
  assert.deepEqual(fenced.json, { a: 'fenced' });
});

const failsWith = async (code: string, status: number | null = null) => {
  await assert.rejects(client().generateJson(request()), (error: unknown) => {
    assert.ok(error instanceof AiCallError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    // Errors carry a code and a status only: never the key, never a body.
    assert.ok(!JSON.stringify(error).includes(KEY));
    assert.ok(!error.message.includes(KEY));
    return true;
  });
};

test('the two "money is out" errors are SPEND_LIMIT and block everything; a bad key is AUTH_FAILED; neither is retryable', async () => {
  reset();
  fake.enqueue({
    kind: 'error',
    status: 400,
    type: 'invalid_request_error',
    message:
      'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.',
  });
  await failsWith('SPEND_LIMIT', 400);
  fake.enqueue(
    {
      kind: 'error',
      status: 429,
      type: 'rate_limit_error',
      message: 'limit',
      error: { details: { error_code: 'enforced_spend_limit_reached' } },
    },
    {
      kind: 'error',
      status: 429,
      type: 'rate_limit_error',
      message: 'limit',
      error: { details: { error_code: 'enforced_spend_limit_reached' } },
    },
  );
  await failsWith('SPEND_LIMIT', 429);
  fake.enqueue({
    kind: 'error',
    status: 401,
    type: 'authentication_error',
    message: 'invalid x-api-key',
  });
  await failsWith('AUTH_FAILED', 401);
  const error = new AiCallError('SPEND_LIMIT', 400);
  assert.equal(error.blocksEverything, true);
  assert.equal(error.retryable, false);
  assert.equal(new AiCallError('AUTH_FAILED').blocksEverything, true);
  assert.equal(new AiCallError('KEY_MISSING').blocksEverything, true);
});

test('rate limits and server errors are retryable; another bad request is not', async () => {
  reset();
  fake.enqueue(
    {
      kind: 'error',
      status: 429,
      type: 'rate_limit_error',
      message: 'slow down',
      headers: { 'retry-after': '0' },
    },
    {
      kind: 'error',
      status: 429,
      type: 'rate_limit_error',
      message: 'slow down',
      headers: { 'retry-after': '0' },
    },
  );
  await failsWith('RATE_LIMITED', 429);
  fake.enqueue(
    { kind: 'error', status: 529, type: 'overloaded_error', message: 'busy' },
    { kind: 'error', status: 529, type: 'overloaded_error', message: 'busy' },
  );
  await failsWith('SERVER', 529);
  fake.enqueue({
    kind: 'error',
    status: 400,
    type: 'invalid_request_error',
    message: 'bad schema',
  });
  await failsWith('BAD_REQUEST', 400);
  assert.equal(new AiCallError('RATE_LIMITED').retryable, true);
  assert.equal(new AiCallError('SERVER').retryable, true);
  assert.equal(new AiCallError('TIMEOUT').retryable, true);
  assert.equal(new AiCallError('BAD_REQUEST').retryable, false);
});

test('a dropped connection is UNREACHABLE and a silent server is TIMEOUT; no key is KEY_MISSING without any request', async () => {
  reset();
  fake.enqueue({ kind: 'drop' }, { kind: 'drop' });
  await failsWith('UNREACHABLE');
  fake.enqueue({ kind: 'hang' }, { kind: 'hang' });
  await assert.rejects(
    client().generateJson(request({ timeoutMs: 300 })),
    (error: unknown) => error instanceof AiCallError && error.code === 'TIMEOUT',
  );
  const before = fake.requests.length;
  await assert.rejects(
    new ClaudeClient({ apiKey: undefined, baseUrl }).generateJson(request()),
    (error: unknown) => error instanceof AiCallError && error.code === 'KEY_MISSING',
  );
  assert.equal(fake.requests.length, before, 'nothing left the process');
  assert.equal(new ClaudeClient({ apiKey: '' }).hasKey, false);
});

test('the key check lists a model (free) and maps a bad key', async () => {
  reset();
  fake.enqueue({ kind: 'message', text: '' });
  await client().checkConnection();
  assert.equal(fake.requests[0]!.path.split('?')[0], '/v1/models');
  fake.enqueue({
    kind: 'error',
    status: 401,
    type: 'authentication_error',
    message: 'invalid x-api-key',
  });
  await assert.rejects(
    client().checkConnection(),
    (error: unknown) => error instanceof AiCallError && error.code === 'AUTH_FAILED',
  );
  await assert.rejects(
    new ClaudeClient({ apiKey: undefined }).checkConnection(),
    (error: unknown) => error instanceof AiCallError && error.code === 'KEY_MISSING',
  );
});

const converseRequest = (patch: Partial<ConverseRequest> = {}): ConverseRequest => ({
  model: 'claude-sonnet-5-5',
  effort: 'low',
  system: 'SYSTEM',
  user: 'Doanh thu tuần này?',
  tools: [
    {
      name: 'revenue',
      description: 'Revenue totals',
      inputSchema: {
        type: 'object',
        properties: { from: { type: 'string' } },
        required: ['from'],
        additionalProperties: false,
      },
    },
  ],
  maxTokens: 2000,
  timeoutMs: 5000,
  maxToolCalls: 3,
  refusalFallback: false,
  runTool: async () => '{"total":1200000}',
  ...patch,
});

test('a question with tools: calls are run and answered in one user message, usage is summed, tools are strict and the choice stays automatic', async () => {
  reset();
  fake.enqueue(
    {
      kind: 'message',
      text: '',
      toolUses: [
        { id: 'toolu_1', name: 'revenue', input: { from: '2026-10-01' } },
        { id: 'toolu_2', name: 'revenue', input: { from: '2026-09-01' } },
      ],
      usage: { input: 1000, output: 40 },
    },
    { kind: 'message', text: 'Doanh thu là 1.200.000 đ.', usage: { input: 1500, output: 60 } },
  );
  const seen: string[] = [];
  const result = await client().converse(
    converseRequest({
      runTool: async (call) => {
        seen.push(call.id);
        return '{"total":1200000}';
      },
    }),
  );
  assert.equal(result.outcome, 'OK');
  assert.equal(result.text, 'Doanh thu là 1.200.000 đ.');
  assert.deepEqual(seen, ['toolu_1', 'toolu_2']);
  assert.equal(result.calls.length, 2);
  assert.equal(result.requests, 2);
  assert.equal(result.usage.inputTokens, 2500);
  assert.equal(result.usage.outputTokens, 100);
  const first = fake.requests[0]!.body;
  assert.equal(first['tool_choice'], undefined);
  const tool = (first['tools'] as Record<string, unknown>[])[0]!;
  assert.equal(tool['strict'], true);
  assert.equal(first['temperature'], undefined);
  const second = fake.requests[1]!.body['messages'] as { role: string; content: unknown }[];
  assert.equal(second.length, 3);
  const back = second[2]!.content as { type: string; tool_use_id: string; content: string }[];
  assert.deepEqual(
    back.map((block) => [block.type, block.tool_use_id]),
    [
      ['tool_result', 'toolu_1'],
      ['tool_result', 'toolu_2'],
    ],
  );
});

test('a failing tool is shown to the model as an error, too many calls end the question, and a refusal or cut-off is an outcome', async () => {
  reset();
  fake.enqueue(
    {
      kind: 'message',
      text: '',
      toolUses: [{ id: 'toolu_1', name: 'revenue', input: { from: 'x' } }],
    },
    { kind: 'message', text: 'Không lấy được số liệu.' },
  );
  const failed = await client().converse(
    converseRequest({
      runTool: async () => {
        throw new Error('database detail that must not reach the model');
      },
    }),
  );
  assert.equal(failed.outcome, 'OK');
  assert.equal(failed.calls[0]!.failed, true);
  const sent = JSON.stringify(fake.requests[1]!.body);
  assert.match(sent, /"is_error":true/);
  assert.doesNotMatch(sent, /database detail/);

  reset();
  fake.enqueue({
    kind: 'message',
    text: '',
    toolUses: [
      { id: 'a', name: 'revenue', input: { from: '1' } },
      { id: 'b', name: 'revenue', input: { from: '2' } },
    ],
  });
  let ran = 0;
  const many = await client().converse(
    converseRequest({
      maxToolCalls: 1,
      runTool: async () => {
        ran += 1;
        return '{}';
      },
    }),
  );
  assert.equal(many.outcome, 'TOO_MANY_TOOLS');
  assert.equal(ran, 0, 'nothing ran past the limit');

  reset();
  fake.enqueue({ kind: 'message', text: '', stopReason: 'refusal', usage: { input: 10 } });
  assert.equal((await client().converse(converseRequest())).outcome, 'REFUSED');
  reset();
  fake.enqueue({ kind: 'message', text: 'cut', stopReason: 'max_tokens' });
  assert.equal((await client().converse(converseRequest())).outcome, 'MAX_TOKENS');
});

test('the whole question has one deadline: a slow tool ends it as a timeout, and no key sends nothing', async () => {
  reset();
  fake.enqueue(
    {
      kind: 'message',
      text: '',
      toolUses: [{ id: 'a', name: 'revenue', input: { from: '1' } }],
    },
    { kind: 'message', text: 'late' },
  );
  const slow = await client().converse(
    converseRequest({
      timeoutMs: 1500,
      runTool: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return '{}';
      },
    }),
  );
  assert.equal(slow.outcome, 'TIMEOUT');
  assert.equal(fake.requests.length, 1);
  await assert.rejects(
    new ClaudeClient({ apiKey: undefined, baseUrl }).converse(converseRequest()),
    (error: unknown) => error instanceof AiCallError && error.code === 'KEY_MISSING',
  );
});
