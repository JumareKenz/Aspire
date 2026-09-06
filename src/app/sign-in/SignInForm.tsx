'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/design/primitives/Button';
import { TextInput } from '@/design/primitives/Field';

export function SignInForm({ prefill }: { prefill?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(prefill ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as
        | { data: { redirectTo: string } }
        | { error: { message: string } };
      if (!response.ok || 'error' in payload) {
        setError('error' in payload ? payload.error.message : 'Sign-in failed.');
        setPending(false);
        return;
      }
      router.replace(payload.data.redirectTo);
      router.refresh();
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <TextInput
        label="Email address"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <TextInput
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-[12px] text-[var(--concern-600)]">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
