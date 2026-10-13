'use client';

import { ContactFab, type ContactFabItem } from '@lucy-spa/ui';
import { useState } from 'react';
import type { Locale } from '../../i18n/locales';
import { ChatPanel } from './chat-panel';

/**
 * The floating contact control with the "Chat với Lucy" item (Claude integration Wave B): the item opens the chat panel, which is
 * only mounted while it is open (so a page that never opens it loads and runs none of the chat).
 */
export function ChatContact({
  locale,
  items,
  labels,
}: {
  locale: Locale;
  items: readonly ContactFabItem[];
  labels: { open: string; close: string; group: string; chat: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ContactFab
        items={items}
        openLabel={labels.open}
        closeLabel={labels.close}
        groupLabel={labels.group}
        chat={{ label: labels.chat, onOpen: () => setOpen(true) }}
      />
      {open ? <ChatPanel locale={locale} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
