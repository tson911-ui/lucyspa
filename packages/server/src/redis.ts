import type { ConnectionOptions } from 'bullmq';

export const SYSTEM_CHECK_QUEUE = 'system-check';
export const QUEUE_PREFIX = 'lucy-spa';

/** Redis carries technical jobs only. It is never a durable business ledger. */
export function redisConnectionOptions(url: string, role: 'producer' | 'worker') {
  const parsed = new URL(url);
  if (
    !['redis:', 'rediss:'].includes(parsed.protocol) ||
    !/^\/(\d+)?$/.test(parsed.pathname || '/')
  ) {
    throw new Error('Invalid Redis connection configuration');
  }
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    connectTimeout: 3000,
    maxRetriesPerRequest: role === 'worker' ? null : 1,
    ...(role === 'producer' ? { commandTimeout: 3000, enableOfflineQueue: false } : {}),
  } satisfies ConnectionOptions;
}
