import { LoyaltyCustomerScreen } from '../../../../../../components/workforce/screens/loyalty-customer';

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <LoyaltyCustomerScreen userId={userId} />;
}
