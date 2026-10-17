'use client';

import { Button } from '@lucy-spa/ui';

/**
 * "Tải lại trang": reloads the page the visitor is on (an action, so a button; the old link always went to the home page, so on the
 * services or products page it left the page instead of reloading it).
 */
export function ReloadButton({ label }: { label: string }) {
  return (
    <Button variant="secondary" onClick={() => window.location.reload()}>
      {label}
    </Button>
  );
}
