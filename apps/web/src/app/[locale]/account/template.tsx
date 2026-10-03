import type { ReactNode } from 'react';
import { RouteFade } from '@lucy-spa/ui';

export default function Template({ children }: { children: ReactNode }) {
  return <RouteFade>{children}</RouteFade>;
}
