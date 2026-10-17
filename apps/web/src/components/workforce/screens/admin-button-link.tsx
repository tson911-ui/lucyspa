'use client';

import type { ButtonLinkComponent } from '@lucy-spa/ui';
import type { ComponentProps } from 'react';
import { PrefetchLink } from '../link';

/**
 * The staff router link in the shape the kit's `ButtonLink LinkComponent` asks for, so a button-styled link (create, Cancel,
 * "Mở hồ sơ điểm") navigates client-side and stays a real link (Ctrl/Cmd+click). The kit types every anchor attribute as optional
 * with `undefined`, Next's `Link` does not accept explicit `undefined` under `exactOptionalPropertyTypes`, hence the narrowing cast.
 */
export const AdminButtonLink: ButtonLinkComponent = (props) => (
  <PrefetchLink {...(props as ComponentProps<typeof PrefetchLink>)} />
);
