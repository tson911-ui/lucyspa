import { BranchDetailScreen } from '../../../../../../components/workforce/screens/branch-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BranchDetailScreen id={id} />;
}
