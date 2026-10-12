import { AiDraftScreen } from '../../../../../../components/workforce/screens/ai-draft-detail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AiDraftScreen id={id} />;
}
