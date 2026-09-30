import { CustomerInvoiceDetailScreen } from '../../../../../../components/customer/screens/invoices';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerInvoiceDetailScreen id={id} />;
}
