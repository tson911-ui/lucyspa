import type { AnchorHTMLAttributes, ComponentType, ReactNode, Ref } from 'react';
import { buttonClass, type ButtonSize, type ButtonVariant } from './button-class';
import { Icon, type IconName } from './icons';

// The stateless action pieces, apart from `Button` (which needs client hooks): no 'use client', so a server page that shows a
// button-styled link or a visually hidden word renders it on the server and ships no client code for it (rbp 'use client'
// placement).

/** The app's router link (Next's Link), so a button-styled link navigates client-side instead of reloading the page. */
export type ButtonLinkComponent = ComponentType<
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
    href: string;
    ref?: Ref<HTMLAnchorElement> | undefined;
    children?: ReactNode;
  }
>;

export type ButtonLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'> & {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  /** Leading icon. */
  icon?: IconName | undefined;
  className?: string | undefined;
  /** The compact density (DESIGN.md 8.1). Inside `data-density='compact'` it is automatic. */
  compact?: boolean | undefined;
  href: string;
  ref?: Ref<HTMLAnchorElement> | undefined;
  /** A router link to render instead of a plain anchor (admin-a request, session 10). */
  LinkComponent?: ButtonLinkComponent | undefined;
};

/** An anchor styled as a button, for navigation actions. */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  icon,
  compact,
  className,
  children,
  ref,
  LinkComponent,
  ...rest
}: ButtonLinkProps) {
  const content = (
    <>
      {icon ? <Icon name={icon} /> : null}
      <span className="ls-btn-label">{children}</span>
    </>
  );
  const classes = buttonClass(variant, size, className, compact);
  return LinkComponent ? (
    <LinkComponent {...rest} ref={ref} className={classes}>
      {content}
    </LinkComponent>
  ) : (
    <a {...rest} ref={ref} className={classes}>
      {content}
    </a>
  );
}

/** Visually hidden text that stays available to assistive technology. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="ls-visually-hidden">{children}</span>;
}
