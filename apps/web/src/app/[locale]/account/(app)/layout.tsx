'use client';

import { RequireCustomer } from '../../../../components/customer/session';
import { CustomerShell } from '../../../../components/customer/shell';

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireCustomer>
      <CustomerShell>{children}</CustomerShell>
    </RequireCustomer>
  );
}
