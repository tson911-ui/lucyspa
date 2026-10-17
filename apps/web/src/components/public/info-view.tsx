import {
  inlineText,
  pageSections,
  parseRichText,
  type PublicPageResponse,
  type RichBlock,
} from '@lucy-spa/contracts';
import { Accordion, InfoPage, Notice, PublicMain } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { fill } from '../../lib/fill';
import { RichBlocks } from './rich-text';

/**
 * The Owner's policies number their parts as bold-only paragraphs ("**1. Điều kiện đổi trả**") instead of `##` headings, so the page had
 * no sections and no table of contents. When a text has no `##` heading but at least two such parts, each becomes a section heading (the
 * words are unchanged; only their role is). Anything else is left as written.
 */
export function promoteSubheads(blocks: readonly RichBlock[]): RichBlock[] {
  if (blocks.some((block) => block.type === 'h2')) return [...blocks];
  const isSubhead = (block: RichBlock) =>
    block.type === 'p' && block.inlines.length === 1 && block.inlines[0]?.type === 'strong';
  if (blocks.filter(isSubhead).length < 2) return [...blocks];
  let count = 0;
  return blocks.map((block) => {
    if (!isSubhead(block) || block.type !== 'p') return block;
    count += 1;
    const strong = block.inlines[0];
    const inlines = strong && strong.type === 'strong' ? strong.children : block.inlines;
    return { type: 'h2', id: `muc-${count}`, text: inlineText(inlines), inlines };
  });
}

/** The day the text last changed, in the shop's zone ("14/10/2026"). */
const DAY_FORMATS = new Map<Locale, Intl.DateTimeFormat>();
function updatedDay(iso: string, locale: Locale): string {
  let format = DAY_FORMATS.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    DAY_FORMATS.set(locale, format);
  }
  return format.format(new Date(iso));
}

/**
 * A published information page (about, a policy, the terms): the C16 `InfoPage` layout, one h1 (the page title) with one sentence under
 * it (the page's own description, else the day it was last updated: B17, the title band never holds the h1 alone), the text in an article
 * column and, from two sections, a table of contents beside it from 1024 px; below that width the same list is a "Trong trang này"
 * disclosure after the opening words, before the first section. The text is whatever the Owner wrote and the API checked; if it cannot be read here it is said so, under
 * the page's h1, rather than drawn half (it never happens for a saved page).
 */
export function InfoPageView({ locale, page }: { locale: Locale; page: PublicPageResponse }) {
  const text = getSiteText(locale);
  const parsed = parseRichText(page.body);
  if (!parsed.ok) {
    return (
      <PublicMain>
        <div className="ls-site-state">
          <h1 className="ls-h1-display">{page.title}</h1>
          <Notice tone="warning">{text.contactPage.loadError}</Notice>
        </div>
      </PublicMain>
    );
  }
  const { intro, sections } = pageSections(promoteSubheads(parsed.blocks));
  const newTabLabel = text.infoPage.newTab;
  const lead =
    page.seoDescription ??
    fill(text.infoPage.updated, { date: updatedDay(page.updatedAt, locale) });
  // Below 1024 px the kit's side table of contents is not drawn: the same links open from a disclosure at the top of the text.
  const phoneToc =
    sections.length >= 2 ? (
      <div className="ls-info-toc-phone">
        <Accordion
          headingLevel={2}
          items={[
            {
              id: 'info-toc',
              title: text.infoPage.toc,
              content: (
                <ol className="ls-info-toc-list">
                  {sections.map((section) => (
                    <li key={section.id}>
                      <a href={`#${section.id}`}>{section.heading}</a>
                    </li>
                  ))}
                </ol>
              ),
            },
          ]}
        />
      </div>
    ) : null;
  return (
    <InfoPage
      title={page.title}
      lead={lead}
      tocLabel={text.infoPage.toc}
      // Vietnamese text shown to an English visitor says so, for readers and search engines.
      language={page.language === locale ? undefined : page.language}
      intro={
        intro.length > 0 || phoneToc ? (
          <>
            {intro.length > 0 ? (
              <RichBlocks blocks={intro} locale={locale} newTabLabel={newTabLabel} />
            ) : null}
            {phoneToc}
          </>
        ) : undefined
      }
      sections={sections.map((section) => ({
        id: section.id,
        heading: section.heading,
        children: <RichBlocks blocks={section.blocks} locale={locale} newTabLabel={newTabLabel} />,
      }))}
    />
  );
}
