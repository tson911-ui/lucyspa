import { PopupFormScreen } from '../../../../../../../components/workforce/screens/website-popup-form';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PopupFormScreen id={id} />;
}
