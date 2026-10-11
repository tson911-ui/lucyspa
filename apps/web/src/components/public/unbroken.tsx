import type { ReactNode } from 'react';

/** A sentence with one value in it (an amount, a time) that must never be split across lines: it breaks before the value, not inside it. */
export function unbroken(template: string, token: string, value: string): ReactNode {
  const [before = '', after = ''] = template.split(token);
  return (
    <>
      {before}
      <span className="ls-nowrap">{value}</span>
      {after}
    </>
  );
}
