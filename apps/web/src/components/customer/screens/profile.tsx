'use client';

import { Card, CardHeader, DescriptionList } from '@lucy-spa/ui';
import { AccountScreen } from '../account-frame';
import { useCustomer, useCustomerAccount } from '../session';

/**
 * "Hồ sơ": the member's own account details, from the session the area already holds (no new request). Read only: the API has no
 * customer profile write yet, so there is nothing to edit here (decision pending with the Owner, see the session 7 report).
 */
export function CustomerProfileScreen() {
  const { t } = useCustomer();
  const { account } = useCustomerAccount();
  return (
    <AccountScreen title={t.home.hubProfile} description={t.home.profileIntro} narrow>
      <Card as="section" aria-label={t.home.profile}>
        <CardHeader title={t.home.profile} />
        <DescriptionList
          items={[
            { label: t.home.name, value: account.displayName },
            {
              label: t.home.languagePref,
              value: account.locale === 'vi' ? 'Tiếng Việt' : 'English',
            },
          ]}
        />
      </Card>
    </AccountScreen>
  );
}
