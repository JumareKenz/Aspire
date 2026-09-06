'use client';

import { useEffect } from 'react';
import { Button } from '@/design/primitives/Button';

/**
 * Page-level error boundary.
 *
 * The message is written for the person reading it, not copied from the
 * exception. The digest is offered because it is the identifier an
 * administrator needs to find the corresponding server log — it is not a stack
 * trace and reveals nothing about the data.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[workspace] render failed', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-[18px] font-semibold tracking-[-0.011em]">
        We couldn’t load this page right now.
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
        This is usually a temporary problem reading the platform’s data. Try again, and if it keeps
        happening ask an administrator to check the synchronisation status.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <a
          href="/overview"
          className="inline-flex h-9 items-center rounded-[var(--radius-md)] border px-3.5 text-[13px] font-medium"
        >
          Back to Overview
        </a>
      </div>
      {error.digest ? (
        <p className="mt-5 font-mono text-[11px] text-[var(--text-tertiary)]">
          Reference: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
