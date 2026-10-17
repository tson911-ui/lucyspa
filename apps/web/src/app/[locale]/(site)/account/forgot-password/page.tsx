import type { Metadata } from 'next';
import { CustomerForgotPasswordScreen } from '../../../../../components/customer/screens/auth';
import { authPageMetadata } from '../../../../../lib/customer/page-metadata';

export function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  return authPageMetadata(params, (auth) => auth.forgotTitle);
}

export default function Page() {
  return <CustomerForgotPasswordScreen />;
}
