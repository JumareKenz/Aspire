import type { ReactNode } from 'react';

/**
 * Page heading.
 *
 * One h1, a single line of context, and the controls that change what the page
 * is showing. Restrained on purpose: the figures below are the content, and an
 * oversized banner would push them below the fold.
 */
export function PageHeader({
  title,
  description,
  controls,
  meta,
}: {
  title: string;
  description?: ReactNode;
  controls?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-[-0.016em] text-[var(--text-primary)]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-[var(--text-secondary)]">
              {description}
            </p>
          ) : null}
          {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {controls ? <div className="min-w-0 max-w-full">{controls}</div> : null}
      </div>
    </header>
  );
}
