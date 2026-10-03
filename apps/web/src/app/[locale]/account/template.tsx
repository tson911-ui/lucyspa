import type { ReactNode } from 'react';
import { RouteEnter } from '@lucy-spa/ui';

export default function Template({ children }: { children: ReactNode }) {
  return <RouteEnter>{children}</RouteEnter>;
}
