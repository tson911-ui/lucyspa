import { pageSections, parseRichText, type PublicPageResponse } from '@lucy-spa/contracts';
import { InfoPage, Notice, PublicMain } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { RichBlocks } from './rich-text';

/**
 * A published information page (about, a policy, the terms): the C16 `InfoPage` layout, one h1 (the page title), the text in an
 * article column and, from two sections, a table of contents beside it. The text is whatever the Owner wrote and the API checked;
 * if it cannot be read here it is said so rather than drawn half (it never happens for a saved page).
 */
export function InfoPageView({ locale, page }: { locale: Locale; page: PublicPageResponse }) {
  const text = getSiteText(locale);
  const parsed = parseRichText(page.body);
  if (!parsed.ok) {
    return (
      <PublicMain>
        <div className="ls-site-state">
          <Notice tone="warning">{text.contactPage.loadError}</Notice>
        </div>
      </PublicMain>
    );
  }
  const { intro, sections } = pageSections(parsed.blocks);
  const newTabLabel = text.infoPage.newTab;
  return (
    <InfoPage
      title={page.title}
      tocLabel={text.infoPage.toc}
      // Vietnamese text shown to an English visitor says so, for readers and search engines.
      language={page.language === locale ? undefined : page.language}
      intro={
        intro.length > 0 ? (
          <RichBlocks blocks={intro} locale={locale} newTabLabel={newTabLabel} />
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
