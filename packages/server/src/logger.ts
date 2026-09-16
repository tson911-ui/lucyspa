import { pino } from 'pino';

export function createLogger(service: string, level: string) {
  return pino({
    level,
    base: { service },
    redact: {
      paths: [
        'password',
        'token',
        'authorization',
        'cookie',
        'databaseUrl',
        'redisUrl',
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      // Errors from drivers can embed URLs, SQL or user values in messages/stacks.
      err: (error: unknown) => ({ type: error instanceof Error ? error.name : 'UnknownError' }),
    },
  });
}
