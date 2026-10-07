import { ReceiptScreen } from '../../../../../../../components/workforce/screens/inventory-receipts';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptScreen id={id} />;
}
