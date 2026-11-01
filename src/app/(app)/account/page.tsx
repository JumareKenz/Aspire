import type { Metadata } from 'next';
import { requireUser, resolveScope } from '@/auth/server';
import { ROLE_LABELS } from '@/auth/rbac';
import { PageHeader } from '@/design/patterns/PageHeader';
import { Card, CardBody, CardHeader } from '@/design/primitives/Card';
import { ChangePasswordForm } from './ChangePasswordForm';

export const metadata: Metadata = { title: 'Account' };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const user = await requireUser();
  const scope = await resolveScope(user);

  return (
    <>
      <PageHeader title="Account" description="Your account details and password." />
      <div className="grid max-w-[880px] gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Your details" description="Your administrator manages these." />
          <CardBody>
            <dl className="space-y-2 text-[12px]">
              {[
                ['Name', user.name],
                ['Email address', user.email],
                ['Role', ROLE_LABELS[user.role]],
                ['Geographic access', user.scope.length === 0 ? 'Programme-wide' : scope.root.name],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4">
                  <dt className="text-[var(--text-tertiary)]">{label}</dt>
                  <dd className="min-w-0 text-right font-medium break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Change password"
            description="Use at least 10 characters. Your other open sessions end when you change it."
          />
          <CardBody>
            <ChangePasswordForm />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
