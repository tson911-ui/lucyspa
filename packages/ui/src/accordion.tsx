'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';

export interface AccordionItem {
  id: string;
  title: string;
  content: ReactNode;
}

/**
 * Disclosure rows for a FAQ (DESIGN.md 8.9): a button with a chevron, a hairline between rows, no `<details>` (FR). Each trigger is a
 * real button inside a heading (`aria-expanded`, `aria-controls`); the panel is a named region and is `hidden` while closed, so its
 * text is out of the tab order. Up and Down arrows, Home and End move between triggers. One row at a time by default; `multiple` lets
 * several stay open. Uncontrolled: `defaultOpen` lists the rows that start open.
 */
export function Accordion({
  items,
  headingLevel = 3,
  multiple = false,
  defaultOpen = [],
  className,
}: {
  items: readonly AccordionItem[];
  /** The level of each row's heading, below the page's section heading. */
  headingLevel?: 2 | 3 | 4 | undefined;
  multiple?: boolean | undefined;
  defaultOpen?: readonly string[] | undefined;
  className?: string | undefined;
}) {
  const base = useId();
  const [open, setOpen] = useState<readonly string[]>(defaultOpen);
  const triggers = useRef<Array<HTMLButtonElement | null>>([]);
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';

  function toggle(id: string) {
    setOpen((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : multiple
          ? [...current, id]
          : [id],
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    const target =
      event.key === 'ArrowDown'
        ? (index + 1) % items.length
        : event.key === 'ArrowUp'
          ? (index - 1 + items.length) % items.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    triggers.current[target]?.focus();
  }

  return (
    <div className={cx('ls-accordion', className)}>
      {items.map((item, index) => {
        const expanded = open.includes(item.id);
        const triggerId = `${base}-${item.id}-trigger`;
        const panelId = `${base}-${item.id}-panel`;
        return (
          <div key={item.id} className="ls-accordion-item" data-open={expanded || undefined}>
            <Heading className="ls-accordion-heading">
              <button
                ref={(element) => {
                  triggers.current[index] = element;
                }}
                type="button"
                id={triggerId}
                className="ls-accordion-trigger"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                <span className="ls-accordion-title">{item.title}</span>
                <Icon name="chevron-down" />
              </button>
            </Heading>
            <div
              id={panelId}
              role="region"
              aria-labelledby={triggerId}
              className="ls-accordion-panel"
              hidden={!expanded}
            >
              {item.content}
            </div>
          </div>
        );
      })}
    </div>
  );
}
