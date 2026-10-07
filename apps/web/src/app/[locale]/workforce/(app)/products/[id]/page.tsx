import { ProductDetailScreen } from '../../../../../../components/workforce/screens/product-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductDetailScreen id={id} />;
}
