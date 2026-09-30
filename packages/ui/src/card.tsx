import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

/**
 * Surface container (docs/UXUI_REDESIGN_DESIGN.md 9.4). One border, radius, shadow and responsive padding
 * for every card-like thing; `ChartFrame` and `KpiCard` share the same surface rules in `components.css`.
 * Do not nest a `Card` inside a `Card`: use `Stat`, lists or plain content inside.
 */
export function Card({
  as: Element = 'div',
  className,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, 'className'> & {
  as?: 'div' | 'section' | 'article' | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Element {...rest} className={cx('ls-card', className)}>
      {children}
    </Element>
  );
}

/** Title row of a card: heading, optional description and a right-aligned action area. */
export function CardHeader({
  title,
  description,
  actions,
  headingLevel = 2,
  id,
}: {
  title: string;
  description?: string | undefined;
  actions?: ReactNode | undefined;
  headingLevel?: 2 | 3 | undefined;
  /** Id of the heading, for `aria-labelledby` on the card. */
  id?: string | undefined;
}) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3';
  return (
    <header className="ls-card-header">
      <div className="ls-card-titles">
        <Heading className="ls-card-title" id={id}>
          {title}
        </Heading>
        {description ? <p className="ls-card-description">{description}</p> : null}
      </div>
      {actions ? <div className="ls-card-actions">{actions}</div> : null}
    </header>
  );
}
