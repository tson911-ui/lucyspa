import { CountScreen } from '../../../../../../../components/workforce/screens/inventory-counts';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CountScreen id={id} />;
}
