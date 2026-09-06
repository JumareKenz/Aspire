import { Skeleton } from '@/design/primitives/States';

/**
 * Shown while a workspace page computes on the server. The shape mirrors the
 * pages it stands in for — a heading, a summary row, then content — so the
 * layout does not jump when the real content arrives.
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="animate-enter">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-2 h-4 w-80" />
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-[var(--radius-lg)]" />
        <Skeleton className="h-48 w-full rounded-[var(--radius-lg)]" />
      </div>
      <Skeleton className="mt-6 h-64 w-full rounded-[var(--radius-lg)]" />
    </div>
  );
}
