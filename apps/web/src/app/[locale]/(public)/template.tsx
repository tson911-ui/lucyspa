import type { ReactNode } from 'react';
import { RouteFade } from '@lucy-spa/ui';

// M5 (Part 2 contract 7): the page content eases in on every navigation inside the public pages (opacity only).
export default function Template({ children }: { children: ReactNode }) {
  return <RouteFade>{children}</RouteFade>;
}
