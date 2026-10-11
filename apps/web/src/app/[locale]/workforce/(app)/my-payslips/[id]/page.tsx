import { MyPayslipScreen } from '../../../../../../components/workforce/screens/payroll-slip';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MyPayslipScreen id={id} />;
}
