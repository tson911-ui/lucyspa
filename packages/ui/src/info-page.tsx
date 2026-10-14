import type { ReactNode } from 'react';
import { cx } from './cx';
import { Band, PublicMain } from './site';

export interface InfoSection {
  /** The anchor of the section and of its table-of-contents entry (letters, digits and dashes). */
  id: string;
  heading: string;
  children: ReactNode;
}

/** The title band every info page opens with (DESIGN.md 9.2): the Back row, the one h1 and its sentence. */
function InfoTitle({
  title,
  lead,
  back,
}: {
  title: string;
  lead?: string | undefined;
  back?: ReactNode;
}) {
  return (
    <Band tone="page" className="ls-band--alt ls-info-title">
      {back}
      <div className="ls-public-title">
        <h1 className="ls-h1-display">{title}</h1>
        {lead ? <p className="ls-lead">{lead}</p> : null}
      </div>
    </Band>
  );
}

/**
 * An info page (about, policies, any page the shop writes for itself): the title band, then one article column of 680 px whose
 * h2 sections are the content's own, and from 1024 px a table of contents beside it. The table is built from the sections and is
 * not drawn for fewer than two, so a short page is only its article. The content is whatever the shop enters; the article styles
 * its own paragraphs, lists, h3, links and pictures.
 */
export function InfoPage({
  title,
  lead,
  back,
  tocLabel,
  intro,
  language,
  sections,
}: {
  title: string;
  lead?: string | undefined;
  back?: ReactNode;
  /** The accessible name of the table of contents ("On this page"). */
  tocLabel: string;
  /** What comes before the first section (no heading, no table-of-contents entry). */
  intro?: ReactNode;
  /** The language of the text when it is not the page's own (an English page showing Vietnamese text), for `lang`. */
  language?: string | undefined;
  sections: readonly InfoSection[];
}) {
  const toc = sections.length >= 2;
  return (
    <PublicMain>
      <InfoTitle title={title} lead={lead} back={back} />
      <Band tone="page" className="ls-band--base">
        <div className="ls-info-layout" data-toc={toc ? 'true' : undefined}>
          <article className="ls-info-article" lang={language}>
            {intro ? <div className="ls-info-intro">{intro}</div> : null}
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="ls-info-section"
                aria-labelledby={`${section.id}-title`}
              >
                <h2 id={`${section.id}-title`} className="ls-info-h2">
                  {section.heading}
                </h2>
                {section.children}
              </section>
            ))}
          </article>
          {toc ? (
            <nav aria-label={tocLabel} className="ls-info-toc">
              <p className="ls-info-toc-title" aria-hidden="true">
                {tocLabel}
              </p>
              <ol>
                {sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{section.heading}</a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
        </div>
      </Band>
    </PublicMain>
  );
}

/**
 * The contact page: the title band, then a split. The place (address and, where there is one, a map) is the left card; the
 * details (hours, phone) and the contact actions (pills) are the right column. Below 768 px the two stack, place first.
 */
export function ContactPage({
  title,
  lead,
  back,
  place,
  details,
  actions,
  className,
}: {
  title: string;
  lead?: string | undefined;
  back?: ReactNode;
  place: ReactNode;
  details: ReactNode;
  /** The contact pills (call, Zalo, Facebook): buttons or links, drawn in one row. */
  actions?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <PublicMain>
      <InfoTitle title={title} lead={lead} back={back} />
      <Band tone="page" className={cx('ls-band--base', className)}>
        <div className="ls-info-split">
          <div className="ls-info-place">{place}</div>
          <div className="ls-info-details">
            {details}
            {actions ? <div className="ls-info-actions">{actions}</div> : null}
          </div>
        </div>
      </Band>
    </PublicMain>
  );
}
