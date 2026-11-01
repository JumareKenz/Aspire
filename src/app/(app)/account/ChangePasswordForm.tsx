'use client';

import { useState } from 'react';
import { Button } from '@/design/primitives/Button';
import { TextInput } from '@/design/primitives/Field';

export function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(false);
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? 'Your password could not be changed.');
        return;
      }
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch {
      setError('We could not reach the server. Try again in a moment.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <TextInput
        label="Current password"
        type="password"
        autoComplete="current-password"
        required
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
      />
      <TextInput
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        value={next}
        onChange={(event) => setNext(event.target.value)}
      />
      <TextInput
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-[12px] text-[var(--concern-600)]">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-[12px] text-[var(--positive-700)]">
          Your password has been changed.
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Changing…' : 'Change password'}
      </Button>
    </form>
  );
}
