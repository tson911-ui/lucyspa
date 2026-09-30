import type { ReactNode } from 'react';
import { cx } from './cx';

export interface DescriptionItem {
  label: string;
  value: ReactNode;
}

/**
 * Label/value pairs for detail pages and confirmation facts (replaces `wf-facts`). Real
 * `<dl><div><dt><dd>` markup; on a phone the pairs stack. An empty value shows `emptyValue`.
 */
export function DescriptionList({
  items,
  columns = 1,
  emptyValue = '—',
  className,
}: {
  items: readonly DescriptionItem[];
  columns?: 1 | 2 | undefined;
  emptyValue?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <dl className={cx('ls-dl', columns === 2 && 'ls-dl-2', className)}>
      {items.map((item) => (
        <div key={item.label} className="ls-dl-row">
          <dt className="ls-dl-term">{item.label}</dt>
          <dd className="ls-dl-value">
            {item.value === null || item.value === undefined || item.value === ''
              ? emptyValue
              : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
