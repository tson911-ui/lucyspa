'use client';

import {
  cloneElement,
  useId,
  useState,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

/**
 * Shows extra text on hover and keyboard focus (Escape dismisses it). Never the only carrier of
 * information. With `describes={false}` the tooltip repeats an existing accessible name (icon
 * buttons) and is hidden from assistive technology.
 */
export function Tooltip({
  content,
  children,
  describes = true,
}: {
  content: string;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  describes?: boolean | undefined;
}) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  const child = describes
    ? cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' '),
      })
    : children;
  return (
    <span
      className="ls-tooltip-wrap"
      data-dismissed={dismissed ? 'true' : undefined}
      onPointerLeave={() => setDismissed(false)}
      onBlur={() => setDismissed(false)}
      onKeyDown={(event: ReactKeyboardEvent) => {
        if (event.key === 'Escape') setDismissed(true);
      }}
    >
      {child}
      <span
        className="ls-tooltip"
        id={id}
        {...(describes ? { role: 'tooltip' } : { 'aria-hidden': true })}
      >
        {content}
      </span>
    </span>
  );
}
