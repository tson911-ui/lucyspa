import { CustomerLoginScreen } from '../../../../../components/customer/screens/auth';

type Query = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// The page reads its own address on the server, so the sign-in card (with its notices) is in the first HTML.
export default async function Page({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const next = first(query['next']);
  return (
    <CustomerLoginScreen
      query={{
        next,
        expired: Boolean(first(query['expired'])),
        signedOut: Boolean(first(query['signedOut'])),
        activated: Boolean(first(query['activated'])),
        reset: Boolean(first(query['reset'])),
      }}
    />
  );
}
