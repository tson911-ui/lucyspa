import type { ReactNode } from 'react';
import { RouteEnter } from '@lucy-spa/ui';

// M5 (Part 2 contract 7): the page content eases in on every navigation inside the public pages (not on the first load).
export default function Template({ children }: { children: ReactNode }) {
  return <RouteEnter>{children}</RouteEnter>;
}
