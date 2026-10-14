import type { RichBlock, RichInline } from '@lucy-spa/contracts';
import Link from 'next/link';
import { Fragment } from 'react';
import type { Locale } from '../../i18n/locales';

/**
 * The text an information page holds, drawn as elements (session 7b). Nothing here sets HTML: a word is a text node, so whatever
 * the Owner writes can only ever look like text, and every link was checked by the same rule when the page was saved (the API
 * refuses the rest) and is checked again below. `/{locale}/...` in a link is the visitor's language.
 */
function Inlines({
  inlines,
  locale,
  newTabLabel,
}: {
  inlines: readonly RichInline[];
  locale: Locale;
  newTabLabel: string;
}) {
  return (
    <>
      {inlines.map((inline, index) => {
        if (inline.type === 'text') return <Fragment key={index}>{inline.text}</Fragment>;
        const children = (
          <Inlines inlines={inline.children} locale={locale} newTabLabel={newTabLabel} />
        );
        if (inline.type === 'strong') return <strong key={index}>{children}</strong>;
        if (inline.type === 'em') return <em key={index}>{children}</em>;
        const href = inline.href.replace('/{locale}', `/${locale}`);
        if (href.startsWith('/')) {
          return (
            <Link key={index} href={href}>
              {children}
            </Link>
          );
        }
        if (href.startsWith('https://')) {
          return (
            <a key={index} href={href} target="_blank" rel="noopener noreferrer">
              {children}
              {newTabLabel === '' ? null : (
                <span className="ls-visually-hidden"> ({newTabLabel})</span>
              )}
            </a>
          );
        }
        // mailto:, tel: and an anchor to a heading of the same page.
        return (
          <a key={index} href={href}>
            {children}
          </a>
        );
      })}
    </>
  );
}

export function RichBlocks({
  blocks,
  locale,
  newTabLabel,
  headings = false,
}: {
  blocks: readonly RichBlock[];
  locale: Locale;
  /** "mở trong tab mới": said for a link that leaves the site. */
  newTabLabel: string;
  /** Draw the `##` headings too (the admin preview). A page draws them itself, as sections with an anchor. */
  headings?: boolean;
}) {
  const inline = (inlines: readonly RichInline[]) => (
    <Inlines inlines={inlines} locale={locale} newTabLabel={newTabLabel} />
  );
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'h2':
            // On a page the section heading is drawn by the page (it owns the anchor and the table of contents entry).
            return headings ? (
              <h2 key={index} id={block.id}>
                {inline(block.inlines)}
              </h2>
            ) : null;
          case 'h3':
            return (
              <h3 key={index} id={block.id}>
                {inline(block.inlines)}
              </h3>
            );
          case 'p':
            return <p key={index}>{inline(block.inlines)}</p>;
          case 'ul':
          case 'ol': {
            const List = block.type;
            return (
              <List key={index}>
                {block.items.map((item, position) => (
                  <li key={position}>{inline(item)}</li>
                ))}
              </List>
            );
          }
        }
      })}
    </>
  );
}
