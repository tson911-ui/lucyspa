import type { ReactNode } from 'react';
import { RouteEnter } from '@lucy-spa/ui';

// Remounts on every navigation: the new page fades in over 120 ms (opacity only, no movement; 0 under reduced motion).
// The first load never animates.
export default function Template({ children }: { children: ReactNode }) {
  return <RouteEnter stack>{children}</RouteEnter>;
}
