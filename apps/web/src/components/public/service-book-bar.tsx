'use client';

import { buttonClass } from '@lucy-spa/ui';
import Link from 'next/link';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { useEffect, useState } from 'react';

/**
 * The phone's booking bar of a service page (DESIGN.md 9.2): the price and the "Đặt lịch" button, stuck to the bottom of the page above the
 * tab bar. It shows only while neither of the page's own booking buttons (`data-book-cta`: the hero's and the booking band's) is on screen, so
 * one primary action is on screen at a time. It is an action bar (`ls-action-bar`), so the contact button lifts above it. From 1024 px the
 * stylesheet never draws it. Hidden until the page has measured, so nothing flashes in.
 */
export function ServiceBookBar({
  href,
  price,
  label,
  action,
}: {
  href: string;
  price: string;
  /** The bar's accessible name. */
  label: string;
  /** The button's words. */
  action: string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const targets = [...document.querySelectorAll('[data-book-cta]')];
    if (targets.length === 0 || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return undefined;
    }
    const visible = new Set<Element>();
    // The top edge is the bottom of the sticky header: a button under the header counts as out of view.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        }
        setShown(visible.size === 0);
      },
      { rootMargin: '-64px 0px 0px 0px' },
    );
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="ls-action-bar ls-svc-bar"
      data-shown={shown ? 'true' : 'false'}
      role="region"
      aria-label={label}
    >
      <p className="ls-svc-bar-price">{price}</p>
      <Link className={buttonClass('primary', 'md')} href={href} transitionTypes={NAV_TRANSITION}>
        {action}
      </Link>
    </div>
  );
}
