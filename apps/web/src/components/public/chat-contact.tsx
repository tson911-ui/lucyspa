'use client';

import { ContactFab, type ContactFabItem } from '@lucy-spa/ui';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { Locale } from '../../i18n/locales';

// The chat code is a chunk of its own, fetched only when the visitor opens the chat (react-best-practices
// bundle-dynamic-imports).
const loadChat = () => import('./chat-panel').then((module) => module.ChatPanel);
const ChatPanel = dynamic(loadChat, { ssr: false });

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
