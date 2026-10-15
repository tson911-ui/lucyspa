import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  headingSlug,
  inlineText,
  isRichTextLink,
  isWebsiteLink,
  pageSections,
  parseRichText,
  RESERVED_PAGE_SLUGS,
  validPageSlug,
  WEBSITE_PAGE_LIMITS,
  type RichBlock,
  type RichHeading,
  type RichInline,
  type RichList,
  type RichParagraph,
} from '@lucy-spa/contracts';

const blocksOf = (source: string): RichBlock[] => {
  const result = parseRichText(source);
  assert.ok(result.ok, JSON.stringify(result));
  return result.blocks;
};
const problemOf = (source: string) => {
  const result = parseRichText(source);
  assert.equal(result.ok, false, source);
  return result.ok ? null : result;
};
const text = (value: string): RichInline => ({ type: 'text', text: value });

test('headings, paragraphs and lists become blocks; lines of a paragraph join, a blank line ends it', () => {
  const blocks = blocksOf(
    [
      'Đoạn mở đầu',
      'tiếp theo.',
      '',
      '## Chính sách đổi trả',
      '',
      'Một đoạn.',
      '',
      '### Điều kiện',
      '- Hóa đơn còn giữ',
      '- Sản phẩm chưa mở',
      '',
      '1. Mang sản phẩm đến',
      '2. Nhân viên kiểm tra',
    ].join('\n'),
  );
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['p', 'h2', 'p', 'h3', 'ul', 'ol'],
  );
  assert.deepEqual(blocks[0], { type: 'p', inlines: [text('Đoạn mở đầu tiếp theo.')] });
  const h2 = blocks[1] as RichHeading;
  assert.equal(h2.id, 'chinh-sach-doi-tra');
  assert.equal(h2.text, 'Chính sách đổi trả');
  const ul = blocks[4] as RichList;
  assert.deepEqual(ul.items, [[text('Hóa đơn còn giữ')], [text('Sản phẩm chưa mở')]]);
  assert.equal((blocks[5] as RichList).items.length, 2);
});

test('bold, italic and links; marks that do not close stay as written', () => {
  const [paragraph] = blocksOf('Xin **chào** bạn, *rất* vui và [xem dịch vụ](/vi/services) nhé.');
  assert.equal(paragraph?.type, 'p');
  const inlines = (paragraph as RichParagraph).inlines;
  assert.deepEqual(
    inlines.map((inline) => inline.type),
    ['text', 'strong', 'text', 'em', 'text', 'link', 'text'],
  );
  assert.deepEqual(inlines[5], {
    type: 'link',
    href: '/vi/services',
    children: [text('xem dịch vụ')],
  });
  // Nothing closes: all text.
  const [stray] = blocksOf('Giá 2 * 3 * 4 và **chưa đóng và [chưa đóng');
  assert.deepEqual((stray as RichParagraph).inlines, [
    text('Giá 2 * 3 * 4 và **chưa đóng và [chưa đóng'),
  ]);
  // A backslash writes the symbol itself.
  const [escaped] = blocksOf('Giá \\*không\\* đổi và \\[không phải liên kết\\](x)');
  assert.equal(
    inlineText((escaped as RichParagraph).inlines),
    'Giá *không* đổi và [không phải liên kết](x)',
  );
  // Bold may hold a link, a link may hold bold, a link may not hold a link.
  const [nested] = blocksOf('**[đặt lịch](/vi/account/book)** và [**gọi**](tel:+84934936101)');
  const flat = JSON.stringify(nested);
  assert.match(flat, /"strong"/);
  assert.match(flat, /"href":"tel:\+84934936101"/);
});

test('every link must follow the rule: https, mailto, tel, an internal path or an anchor', () => {
  for (const ok of [
    'https://lucyspa.vn/chinh-sach',
    '/vi/services',
    '/en/products',
    '/{locale}/account',
    'mailto:lucy@example.com',
    'tel:+84934936101',
    'tel:0934936101',
    '#dieu-khoan',
  ]) {
    assert.equal(isRichTextLink(ok), true, ok);
    assert.ok(parseRichText(`[đây](${ok})`).ok, ok);
  }
  for (const bad of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PGI+',
    'http://insecure.example',
    '//evil.example/x',
    'https://user:pass@example.com',
    'https://',
    '/services',
    'ftp://example.com',
    'mailto:',
    'mailto:a@b',
    'mailto:a@b.vn?subject=x',
    'tel:abc',
    'tel:+84 934',
    '#Có Dấu',
    'vbscript:x',
  ]) {
    assert.equal(isRichTextLink(bad), false, bad);
    const result = problemOf(`[đây](${bad})`);
    assert.equal(result?.ok === false && result.problem, 'link', bad);
  }
  // The popup button and the shop's links use the narrower rule: no mailto, tel or anchor.
  assert.equal(isWebsiteLink('mailto:lucy@example.com'), false);
  assert.equal(isWebsiteLink('https://lucyspa.vn'), true);
});

test('raw HTML, images, other heading levels and control characters are refused with their line', () => {
  const html = problemOf('Một\n\nMột <b>chữ</b> đậm');
  assert.deepEqual(html && { problem: html.problem, line: html.line }, {
    problem: 'html',
    line: 3,
  });
  for (const source of [
    '<script>alert(1)</script>',
    '</p>',
    '<!-- ghi chú -->',
    'a <img src=x>',
    '<?php',
  ]) {
    assert.equal(problemOf(source)?.problem, 'html', source);
  }
  // A "<" that is not a tag is just text, and an escaped one is always text.
  assert.ok(parseRichText('Dưới < 18 tuổi, 3 <= 5 và \\<b> là chữ').ok);
  assert.equal(problemOf('![ảnh](https://example.com/a.png)')?.problem, 'image');
  assert.equal(problemOf('# Tiêu đề lớn')?.problem, 'headingLevel');
  assert.equal(problemOf('#### Cấp bốn')?.problem, 'headingLevel');
  assert.equal(problemOf('Dòng\u0000nhị phân')?.problem, 'control');
  // Direction overrides can make a link read as another address: refused like a control character.
  assert.equal(problemOf('[mở](https://a.example) ‮tệp')?.problem, 'control');
  // "#" without a space is not a heading.
  assert.ok(parseRichText('#hashtag là chữ thường').ok);
});

test('a pipe table: header, rule line, rows; bold and links inside cells; it ends at a blank line or any other text', () => {
  const blocks = blocksOf(
    [
      'Trước bảng.',
      '| Hạng | Điểm | Ưu đãi |',
      '| --- | --- | --- |',
      '| Silver | Từ 500 | Giảm **3%** |',
      '| Gold | Từ 1.000 | Giảm 4% |',
      'Sau bảng.',
      '',
      'Dòng cuối.',
    ].join('\n'),
  );
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['p', 'table', 'p', 'p'],
  );
  const table = blocks[1];
  assert.ok(table?.type === 'table');
  assert.deepEqual(table.header, [[text('Hạng')], [text('Điểm')], [text('Ưu đãi')]]);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[0]?.[2], [text('Giảm '), { type: 'strong', children: [text('3%')] }]);
  // The closing bar is optional (a row starts with "|"), and an escaped bar is text.
  const loose = blocksOf('| Tên | Giá\n| --- | ---\n| A \\| B | 10');
  assert.ok(loose[0]?.type === 'table');
  assert.deepEqual(loose[0].rows[0]?.[0], [text('A | B')]);
});

test('a "|" row that is not a whole table is refused with its line: no rule line, uneven rows, one column, too wide, no data', () => {
  const problem = (source: string) => problemOf(source);
  assert.deepEqual(
    [problem('| A | B |\n| C | D |')?.problem, problem('| A | B |\n| C | D |')?.line],
    ['table', 1],
  );
  assert.deepEqual(
    [
      problem('| A | B |\n| --- | --- |\n| 1 |')?.problem,
      problem('| A | B |\n| --- | --- |\n| 1 |')?.line,
    ],
    ['table', 3],
  );
  assert.equal(problem('| A |\n| --- |\n| 1 |')?.problem, 'table');
  assert.equal(problem('| A | B |\n| --- | --- |')?.problem, 'table');
  assert.equal(problem('| A | B |\n| --- |\n| 1 | 2 |')?.problem, 'table');
  const wide = (n: number) => (cell: string) => `| ${Array(n).fill(cell).join(' | ')} |`;
  assert.equal(problem([wide(7)('a'), wide(7)('---'), wide(7)('1')].join('\n'))?.problem, 'table');
  assert.ok(parseRichText([wide(6)('a'), wide(6)('---'), wide(6)('1')].join('\n')).ok);
  // Markup rules still hold inside a cell.
  assert.equal(problem('| A | B |\n| --- | --- |\n| [x](javascript:1) | 2 |')?.problem, 'link');
  assert.equal(problem('| A | B |\n| --- | --- |\n| <b>x</b> | 2 |')?.problem, 'html');
});

test('empty text, a heading with no words, too long and too many blocks are refused', () => {
  assert.equal(problemOf('')?.problem, 'empty');
  assert.equal(problemOf('   \n\n  ')?.problem, 'empty');
  assert.equal(problemOf('x'.repeat(WEBSITE_PAGE_LIMITS.body + 1))?.problem, 'tooLong');
  assert.ok(parseRichText('x'.repeat(WEBSITE_PAGE_LIMITS.body)).ok);
  const many = Array.from({ length: WEBSITE_PAGE_LIMITS.blocks + 1 }, (_, i) => `Đoạn ${i}`).join(
    '\n\n',
  );
  assert.equal(problemOf(many)?.problem, 'tooManyBlocks');
});

test('heading ids: no accents, unique, never empty', () => {
  assert.equal(headingSlug('Đổi trả & hoàn tiền!'), 'doi-tra-hoan-tien');
  assert.equal(headingSlug('ĐIỀU KHOẢN 1'), 'dieu-khoan-1');
  assert.equal(headingSlug('???'), 'muc');
  const blocks = blocksOf('## Giá\n\n## Giá\n\n### Giá\n\n## Giá');
  assert.deepEqual(
    blocks.map((block) => (block.type === 'h2' || block.type === 'h3' ? block.id : null)),
    ['gia', 'gia-2', 'gia-3', 'gia-4'],
  );
  assert.ok(headingSlug('a'.repeat(200)).length <= 60);
});

test('sections: what comes before the first ## is the intro, each ## owns what follows it', () => {
  const { intro, sections } = pageSections(
    blocksOf('Mở đầu.\n\n## Một\n\nNội dung một.\n\n### Nhỏ\n\n- a\n\n## Hai\n\nNội dung hai.'),
  );
  assert.equal(intro.length, 1);
  assert.deepEqual(
    sections.map((section) => [section.id, section.blocks.map((block) => block.type)]),
    [
      ['mot', ['p', 'h3', 'ul']],
      ['hai', ['p']],
    ],
  );
  assert.deepEqual(pageSections(blocksOf('Chỉ một đoạn.')).sections, []);
});

test('page addresses: lowercase words with dashes, and never a route the site already answers', () => {
  for (const ok of ['chinh-sach-bao-mat', 'dieu-khoan-su-dung', 'gioi-thieu', 'a', 'faq-2026']) {
    assert.equal(validPageSlug(ok), true, ok);
  }
  for (const bad of [
    '',
    'Chinh-Sach',
    'chính-sách',
    '-a',
    'a-',
    'a--b',
    'a b',
    'a/b',
    'a_b',
    'x'.repeat(81),
  ]) {
    assert.equal(validPageSlug(bad), false, bad);
  }
  for (const reserved of RESERVED_PAGE_SLUGS) {
    assert.equal(validPageSlug(reserved), false, reserved);
  }
  assert.ok(RESERVED_PAGE_SLUGS.includes('contact') && RESERVED_PAGE_SLUGS.includes('services'));
});
