'use client';

import { RequireWorkforce } from '../../../../components/workforce/session';
import { WorkforceShell } from '../../../../components/workforce/shell';

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireWorkforce>
      <WorkforceShell>{children}</WorkforceShell>
    </RequireWorkforce>
  );
}
