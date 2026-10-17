'use client';

import type { PublicPopupResponse } from '@lucy-spa/contracts';
import { PromoDialog, type PromoLink } from '@lucy-spa/ui';
import Link from 'next/link';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { publicPopupContent } from '../../lib/popup-core';

const RouterLink: PromoLink = ({ href, className, onClick, children }) => (
  <Link
    href={href}
    transitionTypes={NAV_TRANSITION}
    {...(className ? { className } : {})}
    {...(onClick ? { onClick } : {})}
  >
    {children}
  </Link>
);

/**
 * The popup's dialog, a chunk of its own: `PromoPopup` loads it only once a live popup was found, so a visit without one never
 * downloads the dialog code (react-best-practices bundle-conditional).
 */
export function PromoPopupDialog({
  popup,
  label,
  closeLabel,
  onClose,
}: {
  popup: PublicPopupResponse;
  label: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <PromoDialog
      content={publicPopupContent(popup)}
      label={label}
      closeLabel={closeLabel}
      onClose={onClose}
      LinkComponent={RouterLink}
    />
  );
}
