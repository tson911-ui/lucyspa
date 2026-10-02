import { SeasonFormScreen } from '../../../../../../../components/workforce/screens/website-season-form';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SeasonFormScreen id={id} />;
}
