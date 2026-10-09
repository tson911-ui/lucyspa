import { notFound } from 'next/navigation';

/**
 * Any address under a language that no page answers: a real 404 inside the site frame (header, footer, tab bar), drawn by the
 * group's `not-found.tsx`, instead of the framework's bare English page. More specific routes (services, products, account,
 * workforce, ...) always win over this catch-all.
 */
export default function UnknownPage(): never {
  notFound();
}
