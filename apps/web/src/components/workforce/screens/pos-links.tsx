'use client';

import type { ButtonLinkComponent, MenuLinkComponent } from '@lucy-spa/ui';
import type { ComponentProps } from 'react';
import { PrefetchLink } from '../link';

// The staff router link in the shapes the kit asks for: row-menu items with an `href` ("Xem", "Mở") and button-styled links are
// real links (Ctrl/Cmd+click, middle-click) that navigate client-side without reloading the shell (wig pos.tsx:258 and the "open"
// items of the order, return and count lists).

type LinkProps = ComponentProps<typeof PrefetchLink>;

export const RouterMenuLink: MenuLinkComponent = (props) => <PrefetchLink {...props} />;

// The kit passes plain anchor attributes; Next's Link accepts the same ones (its optional props differ only in `undefined`).
export const RouterButtonLink: ButtonLinkComponent = (props) => (
  <PrefetchLink {...(props as LinkProps)} />
);
