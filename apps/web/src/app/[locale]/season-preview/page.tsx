import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { SeasonPreviewStage } from '../../../components/season/season-preview-stage';
import { isLocale } from '../../../i18n/locales';
import { canPreviewSeasons } from '../../../lib/season-preview-server';

// Read per request: the answer depends on the visitor's session, never on a cache.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The page the admin's full-page season preview draws in a frame (docs/UXUI_REDESIGN_S6_PLAN.md section 6, Owner
 * decision 7). It exists only for a session that holds MANAGE_WEBSITE_CONTENT (checked by the API); anyone else gets a
 * plain 404, so there is no link to share. It contains nothing beyond the public home page.
 */
export default async function SeasonPreviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  if (!(await canPreviewSeasons((await cookies()).toString()))) notFound();
  return <SeasonPreviewStage locale={locale} />;
}
