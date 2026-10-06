import { CustomerBookingDetailScreen } from '../../../../../../../components/customer/screens/bookings';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerBookingDetailScreen id={id} />;
}
