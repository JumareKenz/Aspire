import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/auth/server';
import { ensureBootstrapped, SEED_ACCOUNTS, SEED_DEFAULT_PASSWORD, SEED_PASSWORD_IS_DEFAULT } from '@/data/bootstrap';
import { isDhis2Configured } from '@/data/sources';
import { Logo } from '@/design/patterns/Logo';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  await ensureBootstrapped();
  const user = await getCurrentUser();
  if (user) redirect('/overview');

  const live = isDhis2Configured();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--canvas)] px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex items-center gap-2.5">
          <Logo size={26} />
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.011em]">ASPIRE-GAC</p>
            <p className="text-[12px] text-[var(--text-tertiary)]">SRHR Intelligence &amp; Performance</p>
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border bg-[var(--surface)] p-6 shadow-[var(--shadow-sm)]">
          <h1 className="mb-1 text-[17px] font-semibold tracking-[-0.011em]">Sign in</h1>
          <p className="mb-5 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
            Access is scoped to the geographies and capabilities assigned to your account.
          </p>
          <SignInForm prefill={SEED_PASSWORD_IS_DEFAULT ? SEED_ACCOUNTS[0].email : undefined} />
        </div>

        {SEED_PASSWORD_IS_DEFAULT ? (
          <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--warning-600)]/30 bg-[var(--warning-100)]/50 px-4 py-3">
            <p className="text-[12px] font-medium text-[var(--text-primary)]">
              Development installation
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              Seed accounts were created with the default password{' '}
              <code className="rounded bg-[var(--surface)] px-1 py-px font-mono">
                {SEED_DEFAULT_PASSWORD}
              </code>
              . Set <code className="font-mono">ASPIRE_SEED_PASSWORD</code> before deploying, and
              replace these accounts in Admin → Users.
            </p>
            <ul className="mt-2 space-y-0.5">
              {SEED_ACCOUNTS.map((account) => (
                <li key={account.email} className="text-[11px] text-[var(--text-secondary)]">
                  <span className="font-mono">{account.email}</span> — {account.role.toLowerCase()}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mt-4 text-center text-[11px] text-[var(--text-tertiary)]">
          {live
            ? 'Connected to a DHIS2 instance.'
            : 'No DHIS2 instance is configured — the platform is showing clearly labelled demo data.'}
        </p>
      </div>
    </main>
  );
}
