import { PopupFormScreen } from '../../../../../../../components/workforce/screens/website-popup-form';

// `?season=<id>` opens the form following that season (the season page's "Create popup for this season").
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { season } = await searchParams;
  const seasonId = typeof season === 'string' && /^[0-9a-f-]{36}$/i.test(season) ? season : null;
  return <PopupFormScreen id={null} seasonId={seasonId} />;
}
