import type { MediaAssetSummary } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { owner, render } from '../../../test/support';
import { MediaDescribeStep } from './media-picker';

const asset: MediaAssetSummary = {
  id: '0f6e0a52-2f0c-4a1b-9c55-1f4e2d6a7b8c',
  originalFilename: 'belif.png',
  mime: 'image/png',
  bytes: 342,
  width: 240,
  height: 96,
  altVi: null,
  altEn: null,
  createdAt: '2026-10-17T14:28:11.693Z',
  rowVersion: 1,
};

// Hotfix 2 (2026-10-17). The picker opens inside the form of its host (brand, service, popup, season...) and the kit Dialog is not
// portaled, so a <form> here is a form nested in a form. Proved in Chromium: the submit of a nested form is delivered only to that
// form and never reaches React, nothing calls preventDefault, and the browser sends a GET that reloads the page (the brand form
// vanished and the page fell back to the first tab). jsdom bubbles the event, so only the markup can pin this down.
test('picker description step: no <form> (it is rendered inside the host form), Save is a button and the field is named', () => {
  const markup = render(
    <MediaDescribeStep
      asset={asset}
      onBack={() => undefined}
      onClose={() => undefined}
      onDone={() => undefined}
    />,
    owner,
  );
  assert.match(markup, /Thêm mô tả cho ảnh/);
  assert.doesNotMatch(markup, /<form/, 'a nested form is submitted natively and reloads the page');
  assert.match(markup, /Lưu mô tả và dùng ảnh/);
  assert.doesNotMatch(markup, /type="submit"/);
  assert.match(markup, /<input[^>]*name="altVi"/);
});
