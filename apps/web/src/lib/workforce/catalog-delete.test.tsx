import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfirmDeleteDialog } from '../../components/workforce/confirm-delete';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { context, json, scriptedFetch } from '../../test/support';
import { ApiError, WorkforceApi } from './api';
import {
  deletedMessage,
  deleteErrorMessage,
  deletePath,
  requestDelete,
  withoutDeleted,
  type DeleteTarget,
} from './catalog-delete';

const vi = getWorkforceDictionary('vi');
const service: DeleteTarget = {
  kind: 'service',
  id: 's1',
  name: 'Sơn gel',
  code: 'NAIL_GEL',
  version: 3,
};
const category: DeleteTarget = {
  kind: 'category',
  id: 'c1',
  name: 'Nail',
  code: 'NAIL',
  version: 2,
};

test('the confirmation shows name and code, and opening it sends nothing', () => {
  let requests = 0;
  const api = new WorkforceApi({
    fetch: () => {
      requests += 1;
      return new Promise<Response>(() => undefined);
    },
  });
  const markup = renderToStaticMarkup(
    <ConfirmDeleteDialog
      target={service}
      t={vi}
      onCancel={() => undefined}
      onConfirm={() => requestDelete(api, service).then(() => undefined)}
    />,
  );
  assert.ok(markup.includes('role="alertdialog"'));
  assert.ok(markup.includes(vi.services.deleteServiceTitle));
  assert.ok(markup.includes('Sơn gel') && markup.includes('NAIL_GEL'));
  assert.ok(markup.includes(vi.common.cancel));
  assert.match(markup, new RegExp(`wf-button-danger"[^>]*>${vi.services.deleteServiceConfirm}<`));
  assert.equal(requests, 0, 'no request until the destructive button is pressed');
  const forCategory = renderToStaticMarkup(
    <ConfirmDeleteDialog
      target={category}
      t={vi}
      onCancel={() => undefined}
      onConfirm={() => Promise.resolve()}
    />,
  );
  assert.ok(forCategory.includes(vi.services.deleteCategoryTitle));
  assert.ok(forCategory.includes(vi.services.deleteCategoryConfirm));
});

test('a confirmed deletion is one CSRF-protected POST with the current version only', async () => {
  const { fetcher, calls } = scriptedFetch([
    context('csrf'),
    () => json(200, { id: 's1', deleted: true }),
    () => json(200, { id: 'c1', deleted: true }),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  assert.deepEqual(await requestDelete(api, service), { id: 's1', deleted: true });
  await requestDelete(api, category);
  assert.equal(calls[1]?.url, '/api/v1/services/s1/delete');
  assert.equal(calls[1]?.method, 'POST');
  assert.equal(calls[1]?.headers['X-CSRF-Token'], 'csrf');
  assert.deepEqual(calls[1]?.body, { expectedVersion: 3 });
  assert.equal(calls[2]?.url, '/api/v1/service-categories/c1/delete');
  assert.deepEqual(calls[2]?.body, { expectedVersion: 2 });
  assert.equal(deletePath(service), '/api/v1/services/s1/delete');
});

test('refusals are explained in Vietnamese and never look like a deletion', () => {
  assert.equal(
    deleteErrorMessage(new ApiError(409, 'CONFLICT', 'services'), 'category', vi),
    'Không thể xóa nhóm dịch vụ vì nhóm này vẫn còn dịch vụ. Hãy chuyển hoặc xóa các dịch vụ trước.',
  );
  const inUse = deleteErrorMessage(new ApiError(409, 'CONFLICT', 'inUse'), 'service', vi);
  assert.ok(inUse.includes('Ngừng hoạt động'), 'points to deactivation instead');
  assert.equal(
    deleteErrorMessage(new ApiError(409, 'CONFLICT'), 'service', vi),
    vi.errors.conflict,
  );
  assert.equal(
    deleteErrorMessage(new ApiError(403, 'FORBIDDEN'), 'service', vi),
    vi.errors.forbidden,
  );
  assert.equal(
    deleteErrorMessage(new ApiError(404, 'NOT_FOUND'), 'category', vi),
    vi.errors.notFound,
  );
});

test('after success the row disappears at once and a success message names it', () => {
  const rows = [{ id: 's1' }, { id: 's2' }, { id: 'c1' }];
  assert.deepEqual(withoutDeleted(rows, new Set(['s1'])), [{ id: 's2' }, { id: 'c1' }]);
  assert.deepEqual(withoutDeleted(rows, new Set()), rows, 'nothing removed before success');
  assert.equal(deletedMessage(service, vi), 'Đã xóa dịch vụ “Sơn gel”.');
  assert.equal(deletedMessage(category, vi), 'Đã xóa nhóm dịch vụ “Nail”.');
});
