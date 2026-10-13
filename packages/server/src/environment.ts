import { z } from 'zod';
import { parseAuthEnvironment } from './auth-environment.js';
import { parseMediaStorageDirectory } from './media-storage.js';
import type { PayosConfig } from './payos.js';

const port = z.coerce.number().int().min(1).max(65535);
const databaseUrl = z
  .url()
  .refine(
    (value) =>
      URL.canParse(value) && ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
  );
const redisUrl = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['redis:', 'rediss:'].includes(url.protocol) && /^\/(\d+)?$/.test(url.pathname || '/');
});
const shared = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
const api = shared.extend({
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: port.default(3001),
  WEB_ORIGIN: z.url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  }),
  SWAGGER_ENABLED: z.enum(['true', 'false']).optional(),
  // Claude integration (CI-B1): the read-only bot data listener (design 6.2). Without a key there is no listener.
  BOT_DATA_KEY: z.string().min(32).max(200).optional(),
  BOT_DATA_HOST: z.string().min(1).default('127.0.0.1'),
  BOT_DATA_PORT: port.default(3101),
  // Claude integration (CI-B2): the website chat relays one visitor message to this n8n webhook, with this header secret. Both or none.
  N8N_CHAT_WEBHOOK_URL: z.string().max(500).optional(),
  CHAT_WEBHOOK_SECRET: z.string().max(200).optional(),
});

function validate<S extends z.ZodType>(schema: S, env: NodeJS.ProcessEnv): z.output<S> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Do not include Zod input or URL values; environment values may contain credentials.
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  return parsed.data;
}

const PAYOS_FIELDS = ['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY'] as const;

/**
 * Optional PayOS credentials (Phase 4 Step 8). All three or none: with none the PayOS method is disabled;
 * a partial configuration fails closed at startup. Only field NAMES are ever reported, never a value.
 */
export function parsePayosEnvironment(env: NodeJS.ProcessEnv): PayosConfig | null {
  const values = PAYOS_FIELDS.map((name) => env[name]?.trim() ?? '');
  const present = values.filter((value) => value !== '').length;
  if (present === 0) return null;
  if (present !== PAYOS_FIELDS.length) {
    const missing = PAYOS_FIELDS.filter((_, index) => values[index] === '');
    throw new Error(`Invalid environment configuration: ${missing.join(', ')}`);
  }
  const [clientId, apiKey, checksumKey] = values as [string, string, string];
  return { clientId, apiKey, checksumKey };
}

export function parseWorkerEnvironment(env: NodeJS.ProcessEnv) {
  const config = validate(shared, env);
  return {
    nodeEnv: config.NODE_ENV,
    databaseUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL,
    logLevel: config.LOG_LEVEL,
    payos: parsePayosEnvironment(env),
  };
}

/** The bot data listener: null without a key; the port must differ from the API's own (two listeners cannot share one). */
function botDataOf(config: {
  API_PORT: number;
  BOT_DATA_KEY?: string | undefined;
  BOT_DATA_HOST: string;
  BOT_DATA_PORT: number;
}): { key: string; host: string; port: number } | null {
  if (config.BOT_DATA_KEY === undefined) return null;
  if (config.BOT_DATA_PORT === config.API_PORT) throw new Error('BOT_DATA_PORT');
  return { key: config.BOT_DATA_KEY, host: config.BOT_DATA_HOST, port: config.BOT_DATA_PORT };
}

/**
 * The website chat's n8n webhook (design 6.3): an address and a header secret, both or none (a half configuration fails closed at startup,
 * naming only the variables). The visitor's message is sent there, so a typo must never send it to a stranger: plain http is accepted
 * only for localhost and private addresses (n8n runs on the same server, or on the Docker bridge), https for any host.
 */
export function parseChatWebhook(env: NodeJS.ProcessEnv): { url: string; secret: string } | null {
  const url = env['N8N_CHAT_WEBHOOK_URL']?.trim() ?? '';
  const secret = env['CHAT_WEBHOOK_SECRET']?.trim() ?? '';
  if (url === '' && secret === '') return null;
  if (url === '') throw new Error('Invalid environment configuration: N8N_CHAT_WEBHOOK_URL');
  if (secret.length < 16) throw new Error('Invalid environment configuration: CHAT_WEBHOOK_SECRET');
  if (!URL.canParse(url))
    throw new Error('Invalid environment configuration: N8N_CHAT_WEBHOOK_URL');
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || isPrivateHost(host);
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    !(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && local))
  ) {
    throw new Error('Invalid environment configuration: N8N_CHAT_WEBHOOK_URL');
  }
  return { url: parsed.toString(), secret };
}

/** An IP literal in a loopback, private, link-local or carrier-grade range (a host name other than localhost never counts). */
function isPrivateHost(host: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a = 0, b = 0] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return host === '::1' || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe80:/i.test(host);
}

export function parseApiEnvironment(env: NodeJS.ProcessEnv) {
  const config = validate(api, env);
  return {
    nodeEnv: config.NODE_ENV,
    databaseUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL,
    logLevel: config.LOG_LEVEL,
    host: config.API_HOST,
    port: config.API_PORT,
    webOrigin: config.WEB_ORIGIN,
    auth: parseAuthEnvironment(env, config.NODE_ENV, config.WEB_ORIGIN),
    payos: parsePayosEnvironment(env),
    mediaStorageDir: parseMediaStorageDirectory(env, config.NODE_ENV),
    botData: botDataOf(config),
    chatWebhook: parseChatWebhook(env),
    swaggerEnabled:
      config.SWAGGER_ENABLED === undefined
        ? config.NODE_ENV !== 'production'
        : config.SWAGGER_ENABLED === 'true',
  };
}

export type ApiEnvironment = ReturnType<typeof parseApiEnvironment>;
export type WorkerEnvironment = ReturnType<typeof parseWorkerEnvironment>;
