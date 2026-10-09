import { OnlineOrderDetailScreen } from '../../../../../../components/workforce/screens/online-orders';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OnlineOrderDetailScreen id={id} />;
}
