import type { SeasonOrnamentId } from '@lucy-spa/contracts';
import type { ReactNode } from 'react';
import { cx } from './cx';
import { SeasonOrnament } from './season-ornaments';

// Seasonal banner frame and greeting strip (docs/UXUI_REDESIGN_DESIGN.md 20.2, 20.5). A gradient from the frame tokens
// with the ornament in reserved side gutters, so no ornament ever sits under text. `presetKey` sets `data-season` on
// the frame itself, which scopes a preview (or a header region) to one preset without touching `<html>`; without it
// the frame inherits the season of the page. `effects` takes `<SeasonParticles>`, which stay inside this band.

export function SeasonFrame({
  presetKey,
  ornamentId,
  variant = 'banner',
  effects,
  className,
  children,
}: {
  presetKey?: string | undefined;
  ornamentId: SeasonOrnamentId;
  variant?: 'banner' | 'strip';
  effects?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div
      className={cx('ls-season-frame', `ls-season-frame-${variant}`, className)}
      data-season={presetKey}
    >
      <SeasonOrnament id={ornamentId} className="ls-season-orn ls-season-orn-start" />
      <div className="ls-season-frame-body">{children}</div>
      <SeasonOrnament id={ornamentId} className="ls-season-orn ls-season-orn-end" />
      {effects}
    </div>
  );
}

/** One thin strip with the greeting (plain text, at most 80 characters); wraps to two lines on a phone. */
export function GreetingStrip({
  greeting,
  ornamentId,
  presetKey,
  className,
}: {
  greeting: string;
  ornamentId: SeasonOrnamentId;
  presetKey?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <SeasonFrame
      variant="strip"
      ornamentId={ornamentId}
      presetKey={presetKey}
      className={className}
    >
      <p className="ls-season-greeting">{greeting}</p>
    </SeasonFrame>
  );
}
