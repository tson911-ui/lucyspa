'use client';

import { createContext, type ReactNode } from 'react';

/**
 * The heading level of a form section's title. A page puts its sections directly under the one `h1` (level 2); a
 * dialog or drawer has its own `h2` title, so the sections inside it are level 3. Without a provider it is 3.
 */
export const FormSectionLevel = createContext<2 | 3>(3);

/** A client boundary for the provider, so `Page` can stay a server-compatible component. */
export function FormSectionLevelProvider({
  level,
  children,
}: {
  level: 2 | 3;
  children: ReactNode;
}) {
  return <FormSectionLevel.Provider value={level}>{children}</FormSectionLevel.Provider>;
}
