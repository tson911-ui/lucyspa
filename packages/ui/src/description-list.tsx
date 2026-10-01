import type { ReactNode } from 'react';
import { cx } from './cx';

export interface DescriptionItem {
  label: string;
  value: ReactNode;
  /** `layout="totals"` only: the closing line of the sum (heavier weight). */
  strong?: boolean | undefined;
}

/**
 * Label/value pairs for detail pages and confirmation facts (replaces `wf-facts`). Real
 * `<dl><div><dt><dd>` markup; on a phone the pairs stack. An empty value shows `emptyValue`.
 * `layout="totals"` is the money summary under a table: label at the start, the amount at the
 * trailing edge on one line, so figures line up (never wrap).
 */
export function DescriptionList({
  items,
  columns = 1,
  layout = 'stack',
  emptyValue = '—',
  className,
}: {
  items: readonly DescriptionItem[];
  columns?: 1 | 2 | undefined;
  layout?: 'stack' | 'totals' | undefined;
  emptyValue?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <dl
      className={cx(
        'ls-dl',
        layout === 'stack' && columns === 2 && 'ls-dl-2',
        layout === 'totals' && 'ls-dl-totals',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className={cx('ls-dl-row', item.strong && 'ls-dl-row-strong')}>
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
