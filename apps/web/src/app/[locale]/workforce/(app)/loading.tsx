'use client';

import { LoadingState } from '@lucy-spa/ui';
import { useWorkforce } from '../../../../components/workforce/session';

// Shown inside the shell while a page's code is on its way (a link that was not prefetched yet): the sidebar and top bar
// stay, and the content area holds a title row and a card of rows instead of going blank.
export default function Loading() {
  const { t } = useWorkforce();
  return <LoadingState variant="page" label={t.common.loading} />;
}
