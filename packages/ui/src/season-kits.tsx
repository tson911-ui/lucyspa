import type { ReactNode } from 'react';
import {
  AutumnCorner,
  AutumnDividerArt,
  AutumnLanternPiece,
  AutumnLogo,
  AutumnRail,
  AutumnScene,
} from './season-art-autumn';
import {
  NationalCorner,
  NationalDividerArt,
  NationalLogo,
  NationalNoParticle,
  NationalRail,
  NationalScene,
  type NationalVariant,
} from './season-art-national';
import {
  VuLanCorner,
  VuLanDividerArt,
  VuLanLanternPiece,
  VuLanLogo,
  VuLanRail,
  VuLanScene,
} from './season-art-vulan';
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
import type { ArtProps, SceneProps } from './season-art-kit';
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
  Scene: (props: SceneProps) => ReactNode;
  /** Slot 1: one particle (the index picks its color or shape). */
  Particle: (props: { index: number }) => ReactNode;
  /** `fall` (default) or `rise`, slowly, like a lantern let go. */
  motion?: 'fall' | 'rise';
  /** Phone footer: the first window's width in scene units, chosen so both cuts fall between motifs (default 360). */
  split?: number;
}

/** The two women's-day kits are one drawing set with a variant: the flowers differ (orchids and tulips, lotus). */
const women = (variant: WomenVariant, split: number): KitArt => ({
  split,
  Rail: () => <WomenRail variant={variant} />,
  Corner: (props) => <WomenCorner {...props} variant={variant} />,
  Logo: (props) => <WomenLogo {...props} variant={variant} />,
  Divider: (props) => <WomenDividerArt {...props} variant={variant} />,
  Scene: (props) => <WomenScene {...props} variant={variant} />,
  Particle: WomenPetal,
});

const national = (variant: NationalVariant): KitArt => ({
  split: 310,
  Rail: NationalRail,
  Corner: NationalCorner,
  Logo: (props) => <NationalLogo {...props} variant={variant} />,
  Divider: (props) => <NationalDividerArt {...props} variant={variant} />,
  Scene: (props) => <NationalScene {...props} variant={variant} />,
  // These two kits have no particles; the layer never draws for them.
  Particle: NationalNoParticle,
});

export const KIT_ART: Partial<Record<SeasonArtKit, KitArt>> = {
  valentine: {
    split: 536,
    Rail: ValentineRail,
    Corner: ValentineCorner,
    Logo: ValentineLogoHeart,
    Divider: ValentineDividerArt,
    Scene: ValentineScene,
    Particle: ValentineHeartPiece,
  },
  'womens-day': women('womens-day', 254),
  'vn-womens-day': women('vn-womens-day', 244),
  'reunification-labour': national('reunification-labour'),
  'national-day': national('national-day'),
  'vu-lan': {
    Rail: VuLanRail,
    Corner: VuLanCorner,
    Logo: VuLanLogo,
    Divider: VuLanDividerArt,
    Scene: VuLanScene,
    Particle: VuLanLanternPiece,
    motion: 'rise',
  },
  'mid-autumn': {
    split: 432,
    Rail: AutumnRail,
    Corner: AutumnCorner,
    Logo: AutumnLogo,
    Divider: AutumnDividerArt,
    Scene: AutumnScene,
    Particle: AutumnLanternPiece,
    motion: 'rise',
  },
};
