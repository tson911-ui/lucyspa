import { OnlineOrderDetailScreen } from '../../../../../../../components/shop/orders-screens';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OnlineOrderDetailScreen id={id} />;
}
