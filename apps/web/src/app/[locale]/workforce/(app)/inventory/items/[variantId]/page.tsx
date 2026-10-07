import { InventoryItemScreen } from '../../../../../../../components/workforce/screens/inventory-stock';

export default async function Page({ params }: { params: Promise<{ variantId: string }> }) {
  const { variantId } = await params;
  return <InventoryItemScreen variantId={variantId} />;
}
