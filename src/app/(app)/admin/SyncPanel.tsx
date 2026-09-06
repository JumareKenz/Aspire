'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/design/primitives/Button';
import { Badge } from '@/design/primitives/Badge';

interface ConnectionResult {
  mode: string;
  label: string;
  configured: boolean;
  ok: boolean;
  message: string;
  version?: string;
}

/**
 * Connection test and manual synchronisation.
 *
 * Both report what actually happened, including failures, in the words an
 * administrator needs — the source, the outcome, and the counts.
 */
export function SyncPanel({ canSync }: { canSync: boolean }) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [connection, setConnection] = useState<ConnectionResult | null>(null);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function test() {
    setTesting(true);
    setConnection(null);
    try {
      const response = await fetch('/api/admin/connection');
      const payload = (await response.json()) as { data: ConnectionResult } | { error: { message: string } };
      setConnection(
        'data' in payload
          ? payload.data
          : { mode: '—', label: '—', configured: false, ok: false, message: payload.error.message },
      );
    } catch {
      setConnection({ mode: '—', label: '—', configured: false, ok: false, message: 'Could not reach the server.' });
    } finally {
      setTesting(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const response = await fetch('/api/admin/sync', { method: 'POST' });
      const payload = (await response.json()) as
        | { data: { ok: boolean; message: string } }
        | { error: { message: string } };
      if ('data' in payload) {
        setSyncMessage({ ok: payload.data.ok, text: payload.data.message });
        router.refresh();
      } else {
        setSyncMessage({ ok: false, text: payload.error.message });
      }
    } catch {
      setSyncMessage({ ok: false, text: 'Could not reach the server.' });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void test()} disabled={testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </Button>
        {canSync ? (
          <Button size="sm" variant="primary" onClick={() => void sync()} disabled={syncing}>
            {syncing ? 'Synchronising…' : 'Synchronise now'}
          </Button>
        ) : null}
      </div>

      {connection ? (
        <div className="flex items-start gap-2 text-[12px]">
          <Badge tone={connection.ok ? 'positive' : 'concern'}>{connection.ok ? 'Reachable' : 'Failed'}</Badge>
          <p className="leading-relaxed text-[var(--text-secondary)]">{connection.message}</p>
        </div>
      ) : null}

      {syncMessage ? (
        <div className="flex items-start gap-2 text-[12px]">
          <Badge tone={syncMessage.ok ? 'positive' : 'concern'}>
            {syncMessage.ok ? 'Complete' : 'Failed'}
          </Badge>
          <p className="leading-relaxed text-[var(--text-secondary)]">{syncMessage.text}</p>
        </div>
      ) : null}
    </div>
  );
}
