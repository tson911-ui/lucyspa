import type { ReactNode } from 'react';
import {
  ChristmasDividerArt,
  ChristmasGarland,
  ChristmasGiftsA,
  ChristmasGiftsB,
  ChristmasHat,
  ChristmasHills,
  ChristmasLights,
  ChristmasTree,
} from './season-art-christmas';
import { ArtSvg } from './season-art-kit';
import {
  Blossom,
  TetBand,
  TetCrackers,
  TetDividerArt,
  TetEnvelopes,
  TetLantern,
  TetMaiBranch,
  TetSprig,
  ZODIAC_ART,
} from './season-art-tet';
import { cx } from './cx';

// The decoration slots of the customer site (docs/UXUI_REDESIGN_S6_PLAN.md section 3), server-renderable pieces the
// layouts place around the page: header row, logo accent, divider, greeting strip, footer scene. They are pure
// markup: the colors are `--ls-art-*` tokens, the sizes come from season-art.css, the art is `aria-hidden`. Only the
// footer line and the greeting are readable text, and both sit on a panel (rule 3), never directly on drawing.

/** Kits that have site-wide art (a preset gains one when its own Step ships). */
export const SEASON_ART_KITS = ['tet', 'christmas'] as const;
export type SeasonArtKit = (typeof SEASON_ART_KITS)[number];

export function isSeasonArtKit(key: string | null | undefined): key is SeasonArtKit {
  return (SEASON_ART_KITS as readonly (string | null | undefined)[]).includes(key);
}

/** Zodiac animals that have Tet-style art; any other year draws no animal. */
export function hasZodiacArt(animal: string | null | undefined): boolean {
  return animal != null && Object.prototype.hasOwnProperty.call(ZODIAC_ART, animal);
}

const LANTERNS = 9;
/** The lanterns kept on a phone (the others are hidden by CSS). */
const PHONE_LANTERNS: readonly number[] = [2, 6];

/** Slot 2 and the top two corners of slot 4: the decor row above the site header. */
export function SeasonHeaderRow({ kit }: { kit: SeasonArtKit }) {
  return (
    <div className="ls-art-row ls-art-header" data-kit={kit} aria-hidden="true">
      {kit === 'tet' ? (
        <>
          <TetMaiBranch className="ls-art-corner ls-art-corner-start" />
          <TetMaiBranch className="ls-art-corner ls-art-corner-end" />
          <ArtSvg viewBox="0 0 100 10" preserveAspectRatio="none" className="ls-art-cord">
            <path
              d="M0 1Q50 7 100 1"
              stroke="var(--ls-art-cord)"
              strokeWidth="2.4"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          </ArtSvg>
          <div className="ls-art-lanterns">
            {Array.from({ length: LANTERNS }, (_, index) => (
              <div
                key={index}
                className={cx(
                  'ls-art-lantern-cell',
                  !PHONE_LANTERNS.includes(index) && 'ls-art-hide-narrow',
                  index % 2 === 1 && 'ls-art-hide-medium',
                )}
              >
                <TetLantern className="ls-art-lantern" />
                {index < LANTERNS - 1 ? (
                  <ArtSvg viewBox="-20 -20 40 40" className="ls-art-cord-blossom">
                    <Blossom kind="mai" cx={0} cy={0} size={40} />
                  </ArtSvg>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <ChristmasGarland className="ls-art-corner ls-art-corner-start" />
          <ChristmasGarland className="ls-art-corner ls-art-corner-end" />
          <ChristmasLights variant="wide" />
          <ChristmasLights variant="narrow" />
        </>
      )}
    </div>
  );
}

/** Slot 3: the accent beside the wordmark (a sprig after it, a hat on its top edge); the wordmark itself is `children`. */
export function SeasonLogoAccent({ kit, children }: { kit: SeasonArtKit; children: ReactNode }) {
  return (
    <span className="ls-art-logo" data-kit={kit}>
      {children}
      <span className="ls-art-logo-art" aria-hidden="true">
        {kit === 'tet' ? <TetSprig /> : <ChristmasHat />}
      </span>
    </span>
  );
}

/** Slot 5: a rule with the kit's centrepiece; it replaces the plain border of the header and the footer. */
export function SeasonDivider({ kit }: { kit: SeasonArtKit }) {
  return (
    <div className="ls-art-divider" data-kit={kit} aria-hidden="true">
      <span className="ls-art-divider-line" />
      {kit === 'tet' ? (
        <TetDividerArt className="ls-art-divider-art" />
      ) : (
        <ChristmasDividerArt className="ls-art-divider-art" />
      )}
      <span className="ls-art-divider-line" />
    </div>
  );
}

/**
 * The greeting strip under the header: the greeting on the frame gradient, with `tools` (the effects switch) at its
 * trailing edge, inside the strip so it takes no row of its own (Owner decision 3).
 */
export function SeasonStrip({
  greeting,
  label,
  tools,
}: {
  greeting: string;
  label: string;
  tools?: ReactNode;
}) {
  return (
    <section className="ls-art-strip" aria-label={label}>
      <p className="ls-season-greeting ls-art-strip-text">{greeting}</p>
      {tools ? <div className="ls-art-strip-tools">{tools}</div> : null}
    </section>
  );
}

/**
 * Slot 6 and the bottom two corners of slot 4: the footer scene above the footer text. Tet shows the zodiac animal
 * when art exists for the year (never a wrong one); the greeting line sits on a panel (a solid band for Tet, a snow
 * card for Christmas).
 */
export function SeasonFooterScene({
  kit,
  line,
  sub,
  zodiac,
}: {
  kit: SeasonArtKit;
  line: string;
  sub?: string | undefined;
  /** The year's animal key (Tet only); drawn only when `hasZodiacArt`. */
  zodiac?: string | null | undefined;
}) {
  const Animal = zodiac && hasZodiacArt(zodiac) ? ZODIAC_ART[zodiac] : null;
  return (
    <div className="ls-art-row ls-art-footer" data-kit={kit}>
      <div className="ls-art-footer-art" aria-hidden="true">
        {kit === 'tet' ? (
          <>
            <TetBand className="ls-art-band" />
            <TetCrackers
              rolls={8}
              className="ls-art-crackers ls-art-crackers-start ls-art-show-wide"
            />
            <TetCrackers
              rolls={8}
              className="ls-art-crackers ls-art-crackers-end ls-art-show-wide"
            />
            <TetCrackers
              rolls={3}
              className="ls-art-crackers ls-art-crackers-start ls-art-show-narrow"
            />
            <TetCrackers
              rolls={3}
              className="ls-art-crackers ls-art-crackers-end ls-art-show-narrow"
            />
            <TetEnvelopes className="ls-art-pile ls-art-pile-start" />
            <TetEnvelopes className="ls-art-pile ls-art-pile-end" />
            {Animal ? <Animal className="ls-art-animal" /> : null}
          </>
        ) : (
          <>
            <ChristmasHills className="ls-art-hills" />
            <ChristmasTree className="ls-art-tree ls-art-tree-start" />
            <ChristmasGiftsA className="ls-art-gifts ls-art-gifts-start" />
            <ChristmasTree className="ls-art-tree ls-art-tree-end" />
            <ChristmasGiftsB className="ls-art-gifts ls-art-gifts-end" />
          </>
        )}
      </div>
      <div className="ls-art-footer-text">
        <div className="ls-art-plaque" data-plaque={kit === 'tet' ? 'band' : 'card'}>
          <p className="ls-art-plaque-line">{line}</p>
          {sub ? <p className="ls-art-plaque-sub">{sub}</p> : null}
        </div>
      </div>
    </div>
  );
}
