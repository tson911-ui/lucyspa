import { Fraunces, Nunito_Sans } from 'next/font/google';

// The customer site's pairing (Owner chose direction C, "Ấm áp thư giãn", 2026-10-10): a soft, warm serif for titles and a rounded
// humanist sans for reading. Both have the Vietnamese subset (every stacked mark draws in the font itself) and are self-hosted by
// next/font at build time. The variables are set on the `.ls-site` frame only, so the staff area keeps its own faces; customer.css
// reads them (with the old faces as the fallback, for a frame that does not set them).
const softDisplay = Fraunces({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-fraunces',
});
const humanistText = Nunito_Sans({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '600', '700'],
  display: 'swap',
  variable: '--font-nunito-sans',
});

/** The class names that define the two font variables; put them on the `.ls-site` element. */
export const siteFontClass = `${softDisplay.variable} ${humanistText.variable}`;
