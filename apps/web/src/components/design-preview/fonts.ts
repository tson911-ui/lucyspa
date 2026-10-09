import {
  Bricolage_Grotesque,
  Cormorant_Garamond,
  Fraunces,
  Manrope,
  Nunito_Sans,
  Plus_Jakarta_Sans,
} from 'next/font/google';

// The three directions each get their own pairing. Every face has a Vietnamese subset (every stacked mark draws in the font
// itself) and is self-hosted by next/font at build time, like the faces of the current site.

/** Direction A (editorial): a high-contrast garamond for display, a calm geometric sans for reading. */
export const editorialDisplay = Cormorant_Garamond({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--dp-display',
});
export const editorialText = Manrope({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--dp-text',
});

/** Direction B (modern minimal): one family, tight and confident. */
export const minimalSans = Plus_Jakarta_Sans({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--dp-sans',
});
export const minimalAccent = Bricolage_Grotesque({
  subsets: ['latin', 'vietnamese'],
  weight: ['500', '700'],
  display: 'swap',
  variable: '--dp-accent',
});

/** Direction C (warm wellness): a soft serif with warmth, a rounded humanist sans. */
export const warmDisplay = Fraunces({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--dp-soft',
});
export const warmText = Nunito_Sans({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '600', '700'],
  display: 'swap',
  variable: '--dp-humanist',
});
