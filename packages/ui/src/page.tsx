import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * Page container (docs/UXUI_REDESIGN_DESIGN.md 9.6, 21.4). One per route, hosted by the shell's content
 * region. It owns the gutter, the max width and the 24 px rhythm between its blocks, so a child never
 * carries its own outer margin. `default` is the content width, `form` a single form column, `full` for boards.
 */
export function Page({
  width = 'default',
  className,
  children,
}: {
  width?: 'default' | 'form' | 'full' | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return <div className={cx('ls-page', `ls-page-${width}`, className)}>{children}</div>;
}

/**
 * Page title row: optional breadcrumbs, one `h1`, a one-line description and the page actions at the
 * trailing edge (the primary action last). Actions wrap under the title on a narrow screen.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
}: {
  title: string;
  description?: string | undefined;
  actions?: ReactNode | undefined;
  breadcrumbs?: ReactNode | undefined;
}) {
  return (
    <header className="ls-page-header">
      {breadcrumbs ? <div className="ls-page-crumbs">{breadcrumbs}</div> : null}
      <div className="ls-page-header-row">
        <div className="ls-page-titles">
          <h1 className="ls-page-title">{title}</h1>
          {description ? <p className="ls-page-description">{description}</p> : null}
        </div>
        {actions ? <div className="ls-page-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
