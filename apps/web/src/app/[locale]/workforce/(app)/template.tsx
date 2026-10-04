import type { ReactNode } from 'react';
import { RouteEnter } from '@lucy-spa/ui';

// Remounts on every navigation: the new page eases in (a small rise and fade). The first load never animates.
export default function Template({ children }: { children: ReactNode }) {
  return <RouteEnter stack>{children}</RouteEnter>;
}
