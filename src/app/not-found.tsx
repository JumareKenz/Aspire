import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <h1 className="text-[18px] font-semibold tracking-[-0.011em]">That page doesn’t exist.</h1>
      <p className="mt-2 max-w-md text-[13px] leading-relaxed text-[var(--text-secondary)]">
        The link may be out of date, or it may point at a geography, period or report that is no longer
        available.
      </p>
      <Link
        href="/overview"
        className="mt-5 inline-flex h-9 items-center rounded-[var(--radius-md)] bg-[var(--brand-action)] px-3.5 text-[13px] font-medium text-[var(--brand-action-fg)]"
      >
        Go to Overview
      </Link>
    </main>
  );
}
