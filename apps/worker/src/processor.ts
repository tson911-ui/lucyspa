import { UnrecoverableError } from 'bullmq';

/** Infrastructure diagnostic only. No business jobs are registered in Phase 0. */
export function processSystemCheck(job: { name: string; data: unknown }) {
  if (job.name !== 'ping') throw new UnrecoverableError('No handler registered for this job');
  if (
    typeof job.data !== 'object' ||
    job.data === null ||
    !('nonce' in job.data) ||
    typeof job.data.nonce !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(job.data.nonce)
  ) {
    throw new UnrecoverableError('Invalid diagnostic payload');
  }
  return { status: 'ok' as const, nonce: job.data.nonce };
}
