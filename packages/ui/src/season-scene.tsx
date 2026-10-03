import type { SeasonSlot } from '@lucy-spa/contracts';
import type { CSSProperties, ReactNode } from 'react';
import {
  CelebrationBunch,
  CelebrationBunting,
  CelebrationCake,
  CelebrationCakeMini,
  CelebrationCorner,
  CelebrationDividerArt,
  CelebrationFloor,
  CelebrationFloorConfetti,
  CelebrationGifts,
} from './season-art-celebration';
import {
  ChristmasDividerArt,
  ChristmasGarland,
  ChristmasGiftsA,
  ChristmasGiftsB,
  ChristmasHat,
  ChristmasHills,
  ChristmasLights,
  ChristmasSanta,
  ChristmasSleigh,
  ChristmasSnowman,
  ChristmasTree,
} from './season-art-christmas';
import { ArtSvg, n, SCENE_MID_WIDTH, SCENE_SPLIT } from './season-art-kit';
import {
  Blossom,
  TetBand,
  TetCoupletPair,
  TetCrackers,
  TetDividerArt,
  TetEnvelopes,
  TetFruitTray,
  TetLantern,
  TetMaiBranch,
  TetMelons,
  TetRiceCakes,
  TetSprig,
  ZODIAC_ART,
} from './season-art-tet';
import { KIT_ART } from './season-kits';
import { cx } from './cx';

// The decoration slots of the customer site (docs/UXUI_REDESIGN_S6_PLAN.md section 3), server-renderable pieces the
// layouts place around the page: header row, logo accent, divider, greeting strip, footer scene. They are pure
// markup: the colors are `--ls-art-*` tokens, the sizes come from season-art.css, the art is `aria-hidden`. Only the
// footer line and the greeting are readable text, and both sit on a panel (rule 3), never directly on drawing.
// Each slot can be switched off per event and can show one media-library image instead of its drawn art (S6b).

/** Kits that have site-wide art (a preset gains one when its own Step ships). */
export const SEASON_ART_KITS = [
  'tet',
  'christmas',
  'valentine',
  'womens-day',
  'vn-womens-day',
  'mid-autumn',
  'reunification-labour',
  'national-day',
  'vu-lan',
  'celebration',
] as const;
export type SeasonArtKit = (typeof SEASON_ART_KITS)[number];

export function isSeasonArtKit(key: string | null | undefined): key is SeasonArtKit {
  return (SEASON_ART_KITS as readonly (string | null | undefined)[]).includes(key);
}

/** Zodiac animals that have Tet-style art; any other year draws no animal. */
export function hasZodiacArt(animal: string | null | undefined): boolean {
  return animal != null && Object.prototype.hasOwnProperty.call(ZODIAC_ART, animal);
}

/** The images that replace slots: slot name -> public URL (a path the API serves, never a free address). */
export type SeasonSlotImages = Partial<Record<SeasonSlot, string>>;

/**
 * An image address that is safe to put in `src` or a CSS `url()`: a same-origin absolute path made of plain URL
 * characters. Anything else (a scheme, a host, a quote, a parenthesis, a backslash) is dropped, so a bad value draws
 * the kit's own art instead of a request.
 */
export function safeImageUrl(value: string | null | undefined): string | undefined {
  return typeof value === 'string' &&
    /^\/[A-Za-z0-9/_\-.%]+$/.test(value) &&
    !value.startsWith('//')
    ? value
    : undefined;
}

const backgroundOf = (url: string): CSSProperties => ({ backgroundImage: `url("${url}")` });

/** Slot 7 with an image: a soft picture behind the whole page (the wash itself is CSS on the page wrapper). */
export function SeasonTintImage({ image }: { image?: string | undefined }) {
  const url = safeImageUrl(image);
  return url ? (
    <div className="ls-art-tint-image" style={backgroundOf(url)} aria-hidden="true" />
  ) : null;
}

const LANTERNS = 9;
/** The lanterns kept on a phone (the others are hidden by CSS). */
const PHONE_LANTERNS: readonly number[] = [2, 6];

function CornerPair({ kit }: { kit: SeasonArtKit }) {
  const Corner =
    KIT_ART[kit]?.Corner ??
    (kit === 'tet' ? TetMaiBranch : kit === 'christmas' ? ChristmasGarland : CelebrationCorner);
  return (
    <>
      <Corner className="ls-art-corner ls-art-corner-start" />
      <Corner className="ls-art-corner ls-art-corner-end" />
    </>
  );
}

function HeaderRail({ kit }: { kit: SeasonArtKit }) {
  const { Rail } = KIT_ART[kit] ?? {};
  if (Rail) return <Rail />;
  if (kit === 'tet') {
    return (
      <>
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
    );
  }
  if (kit === 'christmas') {
    return (
      <>
        <ChristmasLights variant="wide" />
        <ChristmasLights variant="narrow" />
      </>
    );
  }
  return (
    <>
      <CelebrationBunting variant="wide" />
      <CelebrationBunting variant="narrow" />
    </>
  );
}

/**
 * Slot 2 and the top two corners of slot 4: the decor row above the site header. A switched-off slot draws nothing;
 * with both off the row is not rendered at all, so it takes no height. A header image repeats across the row; a
 * corner image is one picture, mirrored on the right.
 */
export function SeasonHeaderRow({
  kit,
  header = true,
  corners = true,
  images = {},
}: {
  kit: SeasonArtKit;
  header?: boolean;
  corners?: boolean;
  images?: SeasonSlotImages;
}) {
  if (!header && !corners) return null;
  const headerImage = header ? safeImageUrl(images.header) : undefined;
  const cornerImage = corners ? safeImageUrl(images.corners) : undefined;
  return (
    <div className="ls-art-row ls-art-header" data-kit={kit} aria-hidden="true">
      {headerImage ? (
        <span className="ls-art-header-image" style={backgroundOf(headerImage)} />
      ) : null}
      {corners && !cornerImage ? <CornerPair kit={kit} /> : null}
      {cornerImage ? <CornerImages url={cornerImage} edge="top" /> : null}
      {header && !headerImage ? <HeaderRail kit={kit} /> : null}
    </div>
  );
}

/** The one corner picture of an event: top-left as it is, the others mirrored (`edge` says which pair). */
function CornerImages({ url, edge }: { url: string; edge: 'top' | 'bottom' }) {
  return (
    <>
      {(['start', 'end'] as const).map((side) => (
        // eslint-disable-next-line @next/next/no-img-element -- decoration from the API, sized by CSS
        <img
          key={side}
          className={`ls-art-corner-image ls-art-corner-image-${edge}-${side}`}
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ))}
    </>
  );
}

/**
 * Slot 3: the accent beside the wordmark (a sprig after it, a hat on its top edge, a cake after it); the wordmark
 * itself is `children`. `enabled` false or no accent draws the plain wordmark; an `image` replaces the drawing.
 */
export function SeasonLogoAccent({
  kit,
  children,
  enabled = true,
  image,
}: {
  kit: SeasonArtKit;
  children: ReactNode;
  enabled?: boolean;
  image?: string | undefined;
}) {
  if (!enabled) return children;
  const url = safeImageUrl(image);
  const { Logo } = KIT_ART[kit] ?? {};
  return (
    <span className="ls-art-logo" data-kit={kit} data-image={url ? 'true' : undefined}>
      {children}
      <span className="ls-art-logo-art" aria-hidden="true">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- decoration from the API, sized by CSS
          <img className="ls-art-logo-image" src={url} alt="" loading="lazy" decoding="async" />
        ) : Logo ? (
          <Logo />
        ) : kit === 'tet' ? (
          <TetSprig />
        ) : kit === 'christmas' ? (
          <ChristmasHat />
        ) : (
          <CelebrationCakeMini />
        )}
      </span>
    </span>
  );
}

/**
 * Slot 5: a rule with the kit's centrepiece; it replaces the plain border of the header and the footer. With the
 * slot off (`plain`) only the rule is drawn, so the page keeps its rhythm. An image repeats along the rule.
 */
export function SeasonDivider({
  kit,
  plain = false,
  image,
}: {
  kit: SeasonArtKit;
  plain?: boolean;
  image?: string | undefined;
}) {
  const url = plain ? undefined : safeImageUrl(image);
  const { Divider } = KIT_ART[kit] ?? {};
  return (
    <div
      className="ls-art-divider"
      data-kit={kit}
      data-plain={plain ? 'true' : undefined}
      aria-hidden="true"
    >
      {url ? (
        <span className="ls-art-divider-image" style={backgroundOf(url)} />
      ) : plain ? (
        <span className="ls-art-divider-line" />
      ) : (
        <>
          <span className="ls-art-divider-line" />
          {Divider ? (
            <Divider className="ls-art-divider-art" />
          ) : kit === 'tet' ? (
            <TetDividerArt className="ls-art-divider-art" />
          ) : kit === 'christmas' ? (
            <ChristmasDividerArt className="ls-art-divider-art" />
          ) : (
            <CelebrationDividerArt className="ls-art-divider-art" />
          )}
          <span className="ls-art-divider-line" />
        </>
      )}
    </div>
  );
}

/**
 * The greeting strip under the header: the greeting on the frame gradient, with `tools` (the effects switch) at its
 * trailing edge, inside the strip so it takes no row of its own (Owner decision 3). Without a `greeting` (the event
 * switched the strip greeting off) only the tools remain, bare, so a visitor can still turn the effects off.
 */
export function SeasonStrip({
  greeting,
  label,
  tools,
}: {
  greeting?: string | null | undefined;
  label: string;
  tools?: ReactNode;
}) {
  if (!greeting) {
    return tools ? <div className="ls-art-strip-bare">{tools}</div> : null;
  }
  return (
    <section className="ls-art-strip" aria-label={label}>
      <p className="ls-season-greeting ls-art-strip-text">{greeting}</p>
      {tools ? <div className="ls-art-strip-tools">{tools}</div> : null}
    </section>
  );
}

function FooterArt({
  kit,
  Animal,
}: {
  kit: SeasonArtKit;
  Animal: (typeof ZODIAC_ART)[string] | null;
}) {
  const { Scene, split = SCENE_SPLIT } = KIT_ART[kit] ?? {};
  if (Scene) {
    // One panorama: wide screens crop it to its centre; a phone shows all of it as two rows (centre, then the sides).
    const startShare = `${n((split / SCENE_MID_WIDTH) * 100)}%`;
    return (
      <>
        <Scene className="ls-art-scene ls-art-scene-wide" />
        <div className="ls-art-scene-phone">
          <Scene className="ls-art-scene-mid" part="mid" split={split} />
          <div
            className="ls-art-scene-sides"
            style={{ '--ls-art-scene-start': startShare } as CSSProperties}
          >
            <Scene className="ls-art-scene-side" part="start" split={split} />
            <Scene className="ls-art-scene-side" part="end" split={split} />
          </div>
        </div>
      </>
    );
  }
  if (kit === 'tet') {
    return (
      <>
        <TetBand className="ls-art-band" />
        <TetCoupletPair className="ls-art-couplet ls-art-couplet-start ls-art-hide-medium" />
        <TetCoupletPair className="ls-art-couplet ls-art-couplet-end ls-art-hide-medium" />
        <TetFruitTray className="ls-art-tray ls-art-hide-medium" />
        <TetRiceCakes className="ls-art-cakes ls-art-hide-medium" />
        <TetMelons className="ls-art-melons ls-art-hide-medium" />
        <TetCrackers rolls={8} className="ls-art-crackers ls-art-crackers-start ls-art-show-wide" />
        <TetCrackers rolls={8} className="ls-art-crackers ls-art-crackers-end ls-art-show-wide" />
        <TetCrackers
          rolls={3}
          className="ls-art-crackers ls-art-crackers-start ls-art-show-narrow"
        />
        <TetCrackers rolls={3} className="ls-art-crackers ls-art-crackers-end ls-art-show-narrow" />
        <TetEnvelopes className="ls-art-pile ls-art-pile-start ls-art-only-compact" />
        <TetEnvelopes className="ls-art-pile ls-art-pile-end" />
        {Animal ? <Animal className="ls-art-animal" /> : null}
        {/* Tablets and phones: the pieces the wide scene places around the band stand in one row above it. */}
        <div className="ls-art-shelf">
          <TetCoupletPair className="ls-art-shelf-piece ls-art-shelf-couplet" />
          <TetFruitTray className="ls-art-shelf-piece ls-art-shelf-tray" />
          <TetRiceCakes className="ls-art-shelf-piece ls-art-shelf-cakes" />
          <TetMelons className="ls-art-shelf-piece ls-art-shelf-melons" />
          <TetCoupletPair className="ls-art-shelf-piece ls-art-shelf-couplet" />
        </div>
      </>
    );
  }
  if (kit === 'christmas') {
    return (
      <>
        <ChristmasHills className="ls-art-hills" />
        <ChristmasSleigh className="ls-art-sleigh" />
        <ChristmasSnowman className="ls-art-snowman" />
        <ChristmasSanta className="ls-art-santa" />
        <ChristmasTree className="ls-art-tree ls-art-tree-start" />
        <ChristmasGiftsA className="ls-art-gifts ls-art-gifts-start" />
        <ChristmasTree className="ls-art-tree ls-art-tree-end" />
        <ChristmasGiftsB className="ls-art-gifts ls-art-gifts-end" />
      </>
    );
  }
  return (
    <>
      <CelebrationFloor className="ls-art-floor" />
      <CelebrationFloorConfetti className="ls-art-floor-confetti" />
      <CelebrationBunch className="ls-art-bunch ls-art-bunch-start" />
      <CelebrationBunch className="ls-art-bunch ls-art-bunch-end" flip />
      <CelebrationGifts className="ls-art-party-gifts ls-art-party-gifts-start" />
      <CelebrationGifts className="ls-art-party-gifts ls-art-party-gifts-end" />
      <CelebrationCake className="ls-art-cake" />
    </>
  );
}

/**
 * Slot 6 and the bottom two corners of slot 4: the footer scene above the footer text. Tet shows the zodiac animal
 * when art exists for the year (never a wrong one); the greeting line sits on a panel (a solid band for Tet, a snow
 * or party card for the others). `art` off draws no scene (the greeting line stays, compact, when `greeting` is on);
 * `greeting` off leaves the scene alone; both off render nothing. A footer image is centred; a corner image fills
 * the two bottom corners.
 */
export function SeasonFooterScene({
  kit,
  line,
  sub,
  zodiac,
  art = true,
  greeting = true,
  corners = false,
  images = {},
}: {
  kit: SeasonArtKit;
  line: string;
  sub?: string | undefined;
  /** The year's animal key (Tet only); drawn only when `hasZodiacArt`. */
  zodiac?: string | null | undefined;
  /** Slot 6: the scene's drawing (or its image). */
  art?: boolean;
  /** The greeting line on its panel. */
  greeting?: boolean;
  /** Slot 4 with an image: the picture also fills the bottom corners. */
  corners?: boolean;
  images?: SeasonSlotImages;
}) {
  const cornerImage = corners ? safeImageUrl(images.corners) : undefined;
  const footerImage = art ? safeImageUrl(images.footer) : undefined;
  if (!art && !greeting && !cornerImage) return null;
  const Animal = zodiac && hasZodiacArt(zodiac) ? ZODIAC_ART[zodiac]! : null;
  const compact = !art && !cornerImage;
  // The greeting is page content: with one, the scene is a named region (a landmark), without one it is decoration.
  const Root = greeting ? 'section' : 'div';
  return (
    <Root
      aria-label={greeting ? line : undefined}
      className="ls-art-row ls-art-footer"
      data-kit={kit}
      data-compact={compact ? 'true' : undefined}
      data-scene={art && !footerImage && KIT_ART[kit] ? 'panorama' : undefined}
    >
      {!compact ? (
        <div className="ls-art-footer-art" aria-hidden="true">
          {art && footerImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- decoration from the API, sized by CSS
            <img
              className="ls-art-footer-image"
              src={footerImage}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : null}
          {art && !footerImage ? <FooterArt kit={kit} Animal={Animal} /> : null}
          {cornerImage ? <CornerImages url={cornerImage} edge="bottom" /> : null}
        </div>
      ) : null}
      {greeting ? (
        <div className="ls-art-footer-text">
          <div
            className="ls-art-plaque"
            data-plaque={kit === 'tet' && art && !footerImage ? 'band' : 'card'}
          >
            <p className="ls-art-plaque-line">{line}</p>
            {sub ? <p className="ls-art-plaque-sub">{sub}</p> : null}
          </div>
        </div>
      ) : null}
    </Root>
  );
}
