import type { PublicSiteResponse } from '@lucy-spa/contracts';
import { ContactFab, type ContactFabItem } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { ChatContact } from './chat-contact';

/**
 * The ways to reach the spa for the floating button, in order: Zalo, Messenger, phone. An empty link is left out; the
 * hotline always exists once the shop profile could be read, so the button is only absent when the profile could not be.
 */
export function contactItems(
  site: Pick<PublicSiteResponse, 'zaloUrl' | 'messengerUrl' | 'hotlineTel'> | null,
  text: ReturnType<typeof getSiteText>['contactFab'],
): ContactFabItem[] {
  if (!site) return [];
  return [
    ...(site.zaloUrl ? [{ key: 'zalo' as const, href: site.zaloUrl, label: text.zalo }] : []),
    ...(site.messengerUrl
      ? [{ key: 'messenger' as const, href: site.messengerUrl, label: text.messenger }]
      : []),
    ...(site.hotlineTel
      ? [{ key: 'call' as const, href: `tel:${site.hotlineTel}`, label: text.call }]
      : []),
  ];
}

/** The floating contact button of every public and member page (Owner request 2026-10-06). */
export function ContactWidget({
  locale,
  site,
}: {
  locale: Locale;
  site: PublicSiteResponse | null;
}) {
  const text = getSiteText(locale).contactFab;
  const items = contactItems(site, text);
  // The chat entry (Claude integration Wave B) is part of the same control; it exists only while the Owner has the chat switched on.
  if (site?.chatEnabled) {
    return (
      <ChatContact
        locale={locale}
        items={items}
        labels={{ open: text.open, close: text.close, group: text.group, chat: text.chat }}
      />
    );
  }
  if (items.length === 0) return null;
  return (
    <ContactFab
      items={items}
      openLabel={text.open}
      closeLabel={text.close}
      groupLabel={text.group}
    />
  );
}
