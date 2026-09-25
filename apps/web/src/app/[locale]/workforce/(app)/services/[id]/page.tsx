import { ServiceDetailScreen } from '../../../../../../components/workforce/screens/service-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ServiceDetailScreen id={id} />;
}
