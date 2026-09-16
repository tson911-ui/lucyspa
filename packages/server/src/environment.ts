import { z } from 'zod';

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

export function parseWorkerEnvironment(env: NodeJS.ProcessEnv) {
  const config = validate(shared, env);
  return {
    nodeEnv: config.NODE_ENV,
    databaseUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL,
    logLevel: config.LOG_LEVEL,
  };
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
    swaggerEnabled:
      config.SWAGGER_ENABLED === undefined
        ? config.NODE_ENV !== 'production'
        : config.SWAGGER_ENABLED === 'true',
  };
}

export type ApiEnvironment = ReturnType<typeof parseApiEnvironment>;
export type WorkerEnvironment = ReturnType<typeof parseWorkerEnvironment>;
