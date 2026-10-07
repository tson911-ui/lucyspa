import { ImportScreen } from '../../../../../../components/workforce/screens/import-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImportScreen id={id} />;
}
