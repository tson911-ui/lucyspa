import type { ReactNode } from 'react';
import {
  ValentineCorner,
  ValentineDividerArt,
  ValentineHeartPiece,
  ValentineLogoHeart,
  ValentineRail,
  ValentineScene,
} from './season-art-valentine';
import {
  WomenCorner,
  WomenDividerArt,
  WomenLogo,
  WomenPetal,
  WomenRail,
  WomenScene,
  type WomenVariant,
} from './season-art-women';
import type { ArtProps } from './season-art-kit';
import type { SeasonArtKit } from './season-scene';

// The kits of the S6d/S6e Steps (docs/UXUI_REDESIGN_S6_PLAN.md section 4) as one table, so the scene components place
// every kit the same way: a rail of hanging pieces for the header, a corner, a logo accent, a divider centrepiece, a
// wide footer scene (one SVG cropped to its centre on narrow screens) and the falling glyph of the particle layer.
// Tet, Christmas and Celebration (S6a/S6b) keep their own placed pieces and are not in this table.

export interface KitArt {
  /** Slot 2: the pieces of the header row (a cord and its hanging cells, or a water line). */
  Rail: () => ReactNode;
  /** Slot 4: the top-left corner; the right one is the same drawing mirrored by CSS. */
  Corner: (props: ArtProps) => ReactNode;
  /** Slot 3: the accent beside the wordmark. */
  Logo: (props: ArtProps) => ReactNode;
  /** Slot 5: the centrepiece of the divider. */
  Divider: (props: ArtProps) => ReactNode;
  /** Slot 6: the footer scene. */
  Scene: (props: ArtProps) => ReactNode;
  /** Slot 1: one particle (the index picks its color or shape). */
  Particle: (props: { index: number }) => ReactNode;
  /** `fall` (default) or `rise`, slowly, like a lantern let go. */
  motion?: 'fall' | 'rise';
}

/** The two women's-day kits are one drawing set with a variant: the flowers differ (orchids and tulips, lotus). */
const women = (variant: WomenVariant): KitArt => ({
  Rail: () => <WomenRail variant={variant} />,
  Corner: (props) => <WomenCorner {...props} variant={variant} />,
  Logo: (props) => <WomenLogo {...props} variant={variant} />,
  Divider: (props) => <WomenDividerArt {...props} variant={variant} />,
  Scene: (props) => <WomenScene {...props} variant={variant} />,
  Particle: WomenPetal,
});

export const KIT_ART: Partial<Record<SeasonArtKit, KitArt>> = {
  valentine: {
    Rail: ValentineRail,
    Corner: ValentineCorner,
    Logo: ValentineLogoHeart,
    Divider: ValentineDividerArt,
    Scene: ValentineScene,
    Particle: ValentineHeartPiece,
  },
  'womens-day': women('womens-day'),
  'vn-womens-day': women('vn-womens-day'),
};
