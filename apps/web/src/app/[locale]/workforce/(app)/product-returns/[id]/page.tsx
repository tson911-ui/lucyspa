import { ProductReturnCaseScreen } from '../../../../../../components/workforce/screens/product-returns';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductReturnCaseScreen id={id} />;
}
