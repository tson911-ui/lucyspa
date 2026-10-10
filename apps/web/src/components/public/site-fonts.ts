import { Fraunces, Nunito_Sans } from 'next/font/google';

// The pairing of direction C (Owner chose it for the customer site and, the same day, for the staff screens too): a soft, warm serif
// for titles and a rounded humanist sans for reading. Both have the Vietnamese subset (every stacked mark draws in the font itself)
// and are self-hosted by next/font at build time. The variables are set on the root `<html>` (and on the `.ls-site` frame, which
// the season preview also uses); tokens.css and customer-tokens.css read them, with the old faces as the fallback.
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
