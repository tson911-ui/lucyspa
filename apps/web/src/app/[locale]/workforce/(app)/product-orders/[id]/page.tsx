import { ProductOrderDetailScreen } from '../../../../../../components/workforce/screens/product-orders';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductOrderDetailScreen id={id} />;
}
