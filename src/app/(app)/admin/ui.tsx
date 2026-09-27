'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/design/primitives/cn';

/**
 * Small building blocks shared by the admin data tools (validation and the
 * explorer), so both pages have the same rhythm: generous cards, one tool on
 * screen at a time, and long tables that scroll inside themselves.
 */

/** A pill-style tab strip. The active tab is kept in the URL hash, so a link can open it. */
export function ToolTabs({
  tabs,
}: {
  tabs: Array<{ id: string; label: string; hint?: string; badge?: ReactNode; content: ReactNode }>;
}) {
  const [active, setActive] = useState(tabs[0]?.id ?? '');

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (tabs.some((tab) => tab.id === id)) setActive(id);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [tabs]);

  function choose(id: string) {
    setActive(id);
    window.history.replaceState(null, '', `#${id}`);
  }

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];
  return (
    <div className="flex flex-col gap-5">
      <div
        role="tablist"
        aria-label="Tools"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
      >
        {tabs.map((tab) => {
          const on = tab.id === current?.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={on}
              aria-controls={`panel-${tab.id}`}
              onClick={() => choose(tab.id)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium transition-colors duration-150',
                on
                  ? 'border-[var(--brand-600)] bg-[var(--brand-600)] text-[var(--text-inverse)] shadow-[var(--shadow-sm)]'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]',
              )}
            >
              {tab.label}
              {tab.badge ? <span className={cn('text-[11px] font-semibold', on ? 'opacity-90' : 'text-[var(--text-tertiary)]')}>{tab.badge}</span> : null}
            </button>
          );
        })}
      </div>
      {current ? (
        <div role="tabpanel" id={`panel-${current.id}`} aria-labelledby={`tab-${current.id}`} className="flex flex-col gap-5">
          {current.hint ? <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--text-secondary)]">{current.hint}</p> : null}
          {current.content}
        </div>
      ) : null}
    </div>
  );
}

/** A table area that scrolls within itself, keeping the header row in view. */
export function ScrollArea({ children, maxHeight = 520, className }: { children: ReactNode; maxHeight?: number; className?: string }) {
  return (
    <div
      className={cn(
        'overflow-auto rounded-[var(--radius-lg)] border',
        '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-[var(--surface-sunken)] [&_thead_th]:py-2.5',
        '[&_tbody_td]:py-2.5 [&_tbody_tr:hover]:bg-[var(--surface-sunken)] [&_table]:min-w-[640px]',
        className,
      )}
      style={{ maxHeight }}
    >
      {children}
    </div>
  );
}

/** A labelled group of form controls. */
export function FieldGroup({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-3', className)}>
      <legend className="mb-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">{title}</legend>
      {children}
    </fieldset>
  );
}

/** A removable selection. */
export function Chip({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border bg-[var(--surface)] py-1 pl-3 pr-1.5 text-[12px] text-[var(--text-primary)]">
      <span className="truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--ink-100)] hover:text-[var(--text-primary)]"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
