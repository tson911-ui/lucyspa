import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContactPage, InfoPage } from './info-page';

const sections = [
  { id: 'doi-tra', heading: 'Đổi trả', children: <p>Trong 7 ngày.</p> },
  { id: 'bao-mat', heading: 'Bảo mật', children: <p>Chúng tôi giữ kín thông tin.</p> },
  { id: 'lien-he', heading: 'Liên hệ', children: <p>Gọi hotline.</p> },
];

test('C16 info page: one h1, an article of h2 sections and a table of contents that links to each of them', () => {
  const html = renderToStaticMarkup(
    <InfoPage
      title="Chính sách"
      lead="Quy định của tiệm"
      tocLabel="Trên trang này"
      sections={sections}
    />,
  );
  assert.equal(html.match(/<h1\b/g)?.length, 1);
  assert.equal(html.match(/<h2\b/g)?.length, 3);
  assert.match(html, /<nav aria-label="Trên trang này" class="ls-info-toc">/);
  for (const section of sections) {
    assert.ok(html.includes(`<section id="${section.id}"`));
    assert.ok(html.includes(`href="#${section.id}"`));
    assert.ok(html.includes(`aria-labelledby="${section.id}-title"`));
  }
  assert.match(html, /data-toc="true"/);
  assert.match(html, /class="ls-band ls-band-page ls-info-title"/);
});

test('C16 info page: fewer than two sections (a short page, or none yet) has no table of contents', () => {
  for (const list of [[], sections.slice(0, 1)]) {
    const html = renderToStaticMarkup(
      <InfoPage title="Giới thiệu" tocLabel="Trên trang này" sections={list} />,
    );
    assert.equal(html.match(/<h1\b/g)?.length, 1);
    assert.doesNotMatch(html, /ls-info-toc|data-toc/);
    assert.equal(html.match(/<h2\b/g)?.length ?? 0, list.length);
  }
});

test('info page: an intro before the first section has no heading and no table-of-contents entry; another text language is marked', () => {
  const html = renderToStaticMarkup(
    <InfoPage
      title="Policy"
      tocLabel="On this page"
      intro={<p>Mở đầu.</p>}
      language="vi"
      sections={sections}
    />,
  );
  assert.match(
    html,
    /<article class="ls-info-article" lang="vi"><div class="ls-info-intro"><p>Mở đầu.<\/p><\/div><section/,
  );
  assert.equal(html.match(/<h2\b/g)?.length, 3);
  assert.equal(html.match(/<li>/g)?.length, 3, 'the table lists the sections, not the intro');
  const plain = renderToStaticMarkup(
    <InfoPage title="Policy" tocLabel="On this page" sections={sections} />,
  );
  assert.doesNotMatch(plain, /lang=|ls-info-intro/);
});

test('C16 contact page: the place first, then the details and the contact pills, one h1', () => {
  const html = renderToStaticMarkup(
    <ContactPage
      title="Liên hệ"
      place={<p>04 Nguyễn Quang Bích</p>}
      details={<p>Mỗi ngày 09:00 - 21:00</p>}
      actions={<a href="tel:0934936101">Gọi</a>}
      actionsLabel="Liên hệ nhanh"
    />,
  );
  assert.equal(html.match(/<h1\b/g)?.length, 1);
  assert.ok(html.indexOf('ls-info-place') < html.indexOf('ls-info-details'));
  // The pills are one named navigation landmark, not loose buttons (the audit's orphan-action rule).
  assert.match(
    html,
    /<nav class="ls-info-actions" aria-label="Liên hệ nhanh"><a href="tel:0934936101">Gọi<\/a><\/nav>/,
  );
  const bare = renderToStaticMarkup(
    <ContactPage title="Liên hệ" place={<p>x</p>} details={<p>y</p>} />,
  );
  assert.doesNotMatch(bare, /ls-info-actions/);
});
