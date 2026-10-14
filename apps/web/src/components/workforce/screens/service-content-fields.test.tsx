import assert from 'node:assert/strict';
import { test } from 'node:test';
import { owner, render } from '../../../test/support';
import { MediaPhotoField } from './media-photo-field';
import { ServiceContentFields } from './service-content-fields';

const noop = () => undefined;
const empty = { includedVi: '', includedEn: '', stepsVi: '', stepsEn: '', faqVi: [], faqEn: [] };

test('service content fields: four text boxes and two FAQ lists, empty by default, with the limits in the hints', () => {
  const markup = render(<ServiceContentFields value={empty} onChange={noop} />, owner);
  assert.match(markup, /Nội dung trang dịch vụ/);
  assert.equal(markup.match(/<textarea/g)?.length, 4);
  for (const label of [
    'Dịch vụ bao gồm \\(tiếng Việt\\)',
    'Các bước thực hiện \\(tiếng Anh\\)',
    'Câu hỏi thường gặp \\(tiếng Việt\\)',
  ]) {
    assert.match(markup, new RegExp(label));
  }
  assert.match(markup, /Mỗi dòng một mục\. Tối đa 12 mục\./);
  assert.equal(markup.match(/Thêm câu hỏi/g)?.length, 2);
  assert.doesNotMatch(markup, /Xóa câu hỏi/);
});

test('service content fields: a question row has its question, answer and a remove action; a half-filled pair shows the problem', () => {
  const markup = render(
    <ServiceContentFields
      value={{ ...empty, faqEn: [{ question: 'Does it hurt?', answer: '' }] }}
      onChange={noop}
    />,
    owner,
  );
  assert.match(markup, /value="Does it hurt\?"/);
  assert.equal(markup.match(/Xóa câu hỏi/g)?.length, 1);
  assert.match(markup, /Mỗi câu hỏi cần có cả câu trả lời\. Tối đa 10 câu\./);
  assert.match(markup, /role="alert"|aria-live|ls-notice/);
});

test('photo field: no photo says so and offers Choose; a photo shows the preview with Change and Remove', () => {
  const none = render(<MediaPhotoField mediaId="" onChange={noop} />, owner);
  assert.match(none, /Chưa chọn ảnh\./);
  assert.match(none, /Chọn ảnh/);
  assert.doesNotMatch(none, /Bỏ ảnh|<img/);
  const some = render(
    <MediaPhotoField mediaId="0f6e0a52-2f0c-4a1b-9c55-1f4e2d6a7b8c" onChange={noop} />,
    owner,
  );
  assert.match(
    some,
    /<img[^>]*src="\/api\/v1\/website\/media\/0f6e0a52-2f0c-4a1b-9c55-1f4e2d6a7b8c\/md"/,
  );
  assert.match(some, /Đổi ảnh/);
  assert.match(some, /Bỏ ảnh/);
});
