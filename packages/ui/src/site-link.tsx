import type { ComponentType, ReactNode } from 'react';

// The router link the customer-side navigation components accept: injected (`LinkComponent`) so the kit never imports
// the app's router, as in the Slider. Server-safe.

export type SiteLinkComponent = ComponentType<{
  href: string;
  className?: string | undefined;
  'aria-current'?: 'page' | undefined;
  'aria-label'?: string | undefined;
  hrefLang?: string | undefined;
  lang?: string | undefined;
  'data-emphasis'?: 'true' | undefined;
  children: ReactNode;
}>;

export const PlainLink: SiteLinkComponent = ({ children, ...rest }) => <a {...rest}>{children}</a>;

export interface SiteNavItem {
  key: string;
  label: string;
  href: string;
  current: boolean;
}
