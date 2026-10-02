import { SeasonFrame, SeasonFxToggle, SeasonParticles } from '@lucy-spa/ui';
import { seasonText } from '../../i18n/season';
import type { Locale } from '../../i18n/locales';
import { seasonBandSpec } from '../../lib/season-core';
import { fetchActiveSeason } from '../../lib/season-server';

/**
 * The seasonal band of the customer side (docs/UXUI_REDESIGN_DESIGN.md 20.5): the S2 banner frame with the greeting
 * and the preset's ornaments in the gutters, particles drifting inside the band when the schedule allows them, and
 * the per-device "Turn off effects" button. Server-rendered, so there is no flash; it renders nothing when no
 * season applies to the customer side, and fails closed (a slow or failing API means no band, nothing else changes).
 */
export async function SeasonBand({ locale }: { locale: Locale }) {
  const spec = seasonBandSpec(await fetchActiveSeason(locale));
  if (spec === null) return null;
  const text = seasonText(locale);
  const moving = spec.particle !== 'none';
  return (
    <section className="ls-season-band" aria-label={text.band}>
      <SeasonFrame
        ornamentId={spec.ornamentId}
        effects={moving ? <SeasonParticles kind={spec.particle} /> : undefined}
      >
        <p className="ls-season-greeting">{spec.greeting}</p>
      </SeasonFrame>
      {moving ? (
        <div className="ls-season-band-tools">
          <SeasonFxToggle labels={{ turnOff: text.fxOff, turnOn: text.fxOn }} />
        </div>
      ) : null}
    </section>
  );
}
