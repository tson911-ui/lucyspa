import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * One decoration slot in the season form (S6b): its on/off switch with a one-line hint on the leading side, and its
 * image control on the trailing side (a thumbnail with Choose and Remove buttons). Layout only; the switch and the
 * buttons are the kit's own. Nothing is bordered inside the card: rows are separated by the Stack gap.
 */
export function SeasonSlotRow({
  control,
  hint,
  image,
  className,
}: {
  control: ReactNode;
  hint: string;
  image: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cx('ls-season-slot', className)}>
      <div className="ls-season-slot-main">
        {control}
        <p className="ls-hint">{hint}</p>
      </div>
      <div className="ls-season-slot-image">{image}</div>
    </div>
  );
}

/** The chosen image of a slot as a small square (the library's thumbnail), decorative: the name is on the buttons. */
export function SeasonSlotThumb({ src }: { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- admin library thumbnail, sized by CSS
    <img className="ls-season-slot-thumb" src={src} alt="" loading="lazy" decoding="async" />
  );
}
