import { cx } from './cx';

// Server-safe: class names of the button family, so server components can style a link as a button.

/**
 * `danger` (solid red) is for confirmation dialogs only; a test fails if it appears elsewhere.
 * Everywhere else a destructive action is `danger-outline`.
 * `neutral` is the quiet pill for Cancel, filters and toolbar actions (DESIGN.md 8.1).
 */
export type ButtonVariant =
  'primary' | 'secondary' | 'neutral' | 'ghost' | 'danger-outline' | 'danger';
export type ButtonSize = 'md' | 'lg';

export function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  className?: string | undefined,
  compact?: boolean | undefined,
): string {
  return cx(
    'ls-btn',
    `ls-btn-${variant}`,
    `ls-btn-${size}`,
    compact && 'ls-btn-compact',
    className,
  );
}
