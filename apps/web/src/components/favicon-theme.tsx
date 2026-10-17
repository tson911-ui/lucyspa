'use client';

import { useEffect } from 'react';

/**
 * Runs the owner's `public/favicon-theme.js` after hydration, once per mount of the document root. The script keeps a
 * reference to #lucy-favicon and swaps its href with the browser's colour scheme. Run before hydration, its new href no
 * longer matches the server link and React adds a second, light #lucy-favicon; a change of language remounts the root
 * layout with a fresh link, so the script runs again for it (next/script would load it only once).
 */
export function FaviconTheme() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = '/favicon-theme.js';
    document.body.append(script);
    return () => script.remove();
  }, []);
  return null;
}
