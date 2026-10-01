'use client';

import { createContext, useContext, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';

const InsideCard = createContext(false);

/**
 * Surface container (docs/UXUI_REDESIGN_DESIGN.md 9.4). One border, radius, shadow and responsive padding
 * for every card-like thing; `ChartFrame` and `KpiCard` share the same surface rules in `components.css`.
 * The card is the only bordered container: `DataTable`, `EmptyState` and the like render flush inside it
 * (`components.css`), and a `Card` inside a `Card` is a mistake that logs an error in development.
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
  const nested = useContext(InsideCard);
  if (nested && process.env.NODE_ENV !== 'production') {
    console.error('Card inside Card: use Stat, lists or plain content inside a card.');
  }
  return (
    <InsideCard.Provider value>
      <Element {...rest} className={cx('ls-card', className)}>
        {children}
      </Element>
    </InsideCard.Provider>
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
