import {
  MEDIA_UPLOAD_CONCURRENCY,
  PrecheckError,
  precheckMediaFile,
  type UploadAction,
} from './media';

/** What the queue needs from one file; a browser `File` satisfies it. */
export interface QueuedFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}

export interface UploadQueueOptions<F extends QueuedFile> {
  /** Sends one file; resolves with whether the library already had it. */
  upload: (
    file: F,
    control: { onProgress: (percent: number) => void; signal: AbortSignal },
  ) => Promise<{ duplicate: boolean }>;
  /** Every state change, for the reducer behind the queue list. */
  emit: (action: UploadAction) => void;
  /** After the last upload settles, when at least one NEW image was stored. */
  onIdle: (stored: number) => void;
  concurrency?: number;
}

/**
 * Upload queue of the media library: files the browser can already refuse (type, size) fail at once;
 * the rest wait and are sent a few at a time. A cancelled file leaves the list; a failed one stays with
 * its error. Plain TypeScript so the rules are testable without a DOM.
 */
export class UploadQueue<F extends QueuedFile> {
  private readonly waiting: { key: string; file: F }[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private running = 0;
  private stored = 0;
  private sequence = 0;
  private disposed = false;

  constructor(private readonly options: UploadQueueOptions<F>) {}

  add(files: readonly F[]): void {
    const items = files.map((file) => {
      this.sequence += 1;
      const key = `upload-${this.sequence}`;
      const problem = precheckMediaFile(file);
      if (problem) {
        return {
          key,
          name: file.name,
          status: 'failed' as const,
          progress: null,
          error: new PrecheckError(problem),
        };
      }
      this.waiting.push({ key, file });
      return { key, name: file.name, status: 'queued' as const, progress: null };
    });
    this.options.emit({ type: 'add', items });
    this.pump();
  }

  /** A waiting file is dropped; a running one is aborted (and dropped when its request settles). */
  cancel(key: string): void {
    const index = this.waiting.findIndex((job) => job.key === key);
    if (index >= 0) {
      this.waiting.splice(index, 1);
      this.options.emit({ type: 'dismiss', key });
      return;
    }
    this.controllers.get(key)?.abort();
  }

  /** Leaving the page: abort what is running and send nothing more. */
  dispose(): void {
    this.disposed = true;
    this.waiting.length = 0;
    for (const controller of this.controllers.values()) controller.abort();
  }

  private pump(): void {
    const limit = this.options.concurrency ?? MEDIA_UPLOAD_CONCURRENCY;
    while (!this.disposed && this.running < limit && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      const controller = new AbortController();
      this.controllers.set(job.key, controller);
      this.running += 1;
      this.options.emit({ type: 'start', key: job.key });
      this.options
        .upload(job.file, {
          onProgress: (percent) => this.options.emit({ type: 'progress', key: job.key, percent }),
          signal: controller.signal,
        })
        .then((result) => {
          if (!result.duplicate) this.stored += 1;
          this.options.emit({ type: 'finish', key: job.key, duplicate: result.duplicate });
        })
        .catch((error: unknown) => {
          this.options.emit(
            controller.signal.aborted
              ? { type: 'dismiss', key: job.key }
              : { type: 'fail', key: job.key, error },
          );
        })
        .finally(() => {
          this.controllers.delete(job.key);
          this.running -= 1;
          this.pump();
          if (
            !this.disposed &&
            this.running === 0 &&
            this.waiting.length === 0 &&
            this.stored > 0
          ) {
            const count = this.stored;
            this.stored = 0;
            this.options.onIdle(count);
          }
        });
    }
  }
}
