import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from './api';
import { PrecheckError, uploadReducer, type UploadAction, type UploadItem } from './media';
import { UploadQueue, type QueuedFile } from './media-upload';

const png = (name: string, size = 10): QueuedFile => ({ name, type: 'image/png', size });

/** A queue whose uploads settle when the test says so. */
function harness(concurrency = 3) {
  const actions: UploadAction[] = [];
  let state: UploadItem[] = [];
  const idle: number[] = [];
  const pending = new Map<
    string,
    {
      resolve: (value: { duplicate: boolean }) => void;
      reject: (error: unknown) => void;
      signal: AbortSignal;
      progress: (percent: number) => void;
    }
  >();
  const queue = new UploadQueue<QueuedFile>({
    concurrency,
    emit: (action) => {
      actions.push(action);
      state = uploadReducer(state, action);
    },
    onIdle: (count) => idle.push(count),
    upload: (file, control) =>
      new Promise((resolve, reject) => {
        pending.set(file.name, {
          resolve,
          reject,
          signal: control.signal,
          progress: control.onProgress,
        });
        control.signal.addEventListener('abort', () =>
          reject(new DOMException('cancelled', 'AbortError')),
        );
      }),
  });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  return { queue, actions, idle, pending, tick, state: () => state };
}

const statuses = (state: UploadItem[]) => state.map((item) => `${item.name}:${item.status}`);

test('files the browser can refuse fail at once and never reach the network', async () => {
  const h = harness();
  h.queue.add([
    { name: 'a.svg', type: 'image/svg+xml', size: 5 },
    png('big.png', 11 * 1024 * 1024),
  ]);
  assert.deepEqual(statuses(h.state()), ['a.svg:failed', 'big.png:failed']);
  assert.ok(h.state().every((item) => item.error instanceof PrecheckError));
  assert.deepEqual(
    h.state().map((item) => (item.error as PrecheckError).problem),
    ['type', 'size'],
  );
  assert.equal(h.pending.size, 0);
  await h.tick();
  assert.deepEqual(h.idle, [], 'nothing was stored');
});

test('three at a time: the rest wait and start as slots free up', async () => {
  const h = harness();
  h.queue.add(['1', '2', '3', '4', '5'].map((n) => png(`${n}.png`)));
  assert.deepEqual(statuses(h.state()), [
    '1.png:uploading',
    '2.png:uploading',
    '3.png:uploading',
    '4.png:queued',
    '5.png:queued',
  ]);
  h.pending.get('2.png')!.progress(40);
  assert.equal(h.state()[1]?.progress, 40);
  h.pending.get('2.png')!.resolve({ duplicate: false });
  await h.tick();
  assert.deepEqual(statuses(h.state()).slice(1, 4), [
    '2.png:done',
    '3.png:uploading',
    '4.png:uploading',
  ]);
  assert.equal(h.pending.has('5.png'), false, 'still waiting');
});

test('idle callback: once, after the last upload, counting new images but not repeats', async () => {
  const h = harness();
  h.queue.add([png('a.png'), png('b.png'), png('c.png')]);
  h.pending.get('a.png')!.resolve({ duplicate: false });
  h.pending.get('b.png')!.resolve({ duplicate: true });
  await h.tick();
  assert.deepEqual(h.idle, [], 'c.png is still running');
  h.pending.get('c.png')!.resolve({ duplicate: false });
  await h.tick();
  assert.deepEqual(h.idle, [2]);
  assert.deepEqual(statuses(h.state()), ['a.png:done', 'b.png:duplicate', 'c.png:done']);
});

test('a failure stays in the list with its error; the others carry on', async () => {
  const h = harness();
  h.queue.add([png('a.png'), png('b.png')]);
  h.pending.get('a.png')!.reject(new ApiError(415, 'MEDIA_TYPE_UNSUPPORTED'));
  h.pending.get('b.png')!.resolve({ duplicate: false });
  await h.tick();
  assert.deepEqual(statuses(h.state()), ['a.png:failed', 'b.png:done']);
  assert.equal((h.state()[0]?.error as ApiError).code, 'MEDIA_TYPE_UNSUPPORTED');
  assert.deepEqual(h.idle, [1]);
});

test('cancel: a waiting file is dropped, a running one is aborted and dropped', async () => {
  const h = harness(1);
  h.queue.add([png('a.png'), png('b.png'), png('c.png')]);
  h.queue.cancel(h.state()[1]!.key);
  assert.deepEqual(statuses(h.state()), ['a.png:uploading', 'c.png:queued']);
  h.queue.cancel(h.state()[0]!.key);
  await h.tick();
  assert.equal(h.pending.get('a.png')!.signal.aborted, true);
  assert.deepEqual(statuses(h.state()), ['c.png:uploading'], 'the next file takes the slot');
  assert.deepEqual(h.idle, [], 'a cancelled file is not a stored image');
});

test('leaving the page aborts what runs and starts nothing more', async () => {
  const h = harness(1);
  h.queue.add([png('a.png'), png('b.png')]);
  h.queue.dispose();
  await h.tick();
  assert.equal(h.pending.get('a.png')!.signal.aborted, true);
  assert.equal(h.pending.has('b.png'), false);
  assert.deepEqual(h.idle, []);
});
