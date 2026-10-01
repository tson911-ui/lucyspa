import { DiscountVersionScreen } from '../../../../../../../../components/workforce/screens/discount-version';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DiscountVersionScreen id={id} />;
}
