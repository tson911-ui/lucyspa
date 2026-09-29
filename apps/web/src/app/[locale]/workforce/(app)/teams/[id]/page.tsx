import { TeamDetailScreen } from '../../../../../../components/workforce/screens/teams';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TeamDetailScreen id={id} />;
}
