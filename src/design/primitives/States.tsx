import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * Empty, loading and error states are first-class.
 *
 * A blank panel tells a user nothing; the product says what is missing, why,
 * and what would change it. Technical detail is shown only where the reader can
 * act on it — administrators — and is never a raw stack trace.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed px-6 py-10 text-center',
        className,
      )}
    >
      <p className="text-[13px] font-medium text-[var(--text-primary)]">{title}</p>
      {description ? (
        <p className="max-w-md text-[12px] leading-relaxed text-[var(--text-tertiary)]">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'We couldn\u2019t load this right now.',
  description = 'This is usually a temporary problem with the data connection. Try again in a moment.',
  technical,
  action,
}: {
  title?: string;
  description?: string;
  /** Shown only to administrators, who can act on it. */
  technical?: string | null;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--concern-600)]/30 bg-[var(--concern-100)]/40 px-5 py-4">
      <p className="text-[13px] font-medium text-[var(--text-primary)]">{title}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">{description}</p>
      {technical ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-[var(--text-tertiary)]">
            Technical detail
          </summary>
          <pre className="mt-1 overflow-x-auto rounded bg-[var(--surface-sunken)] p-2 text-[11px] whitespace-pre-wrap text-[var(--text-secondary)]">
            {technical}
          </pre>
        </details>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

export function LoadingBlock({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-4 w-full" />
      ))}
    </div>
  );
}
