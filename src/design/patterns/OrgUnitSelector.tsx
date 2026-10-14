'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { OrgLevel } from '@/core/model/types';
import { cn } from '../primitives/cn';
import { LEVEL_LABEL } from './levels';

/**
 * Geography selection, as a hierarchy.
 *
 * Behaves like DHIS2's organisation unit tree: the top of the user's access is
 * open, each unit expands to its children (wards and facilities are loaded on
 * demand), search finds a unit by name and shows where it sits, and any level
 * the user may read can be chosen. The tree is seeded from the server with the
 * units already resolved against the user's scope, and every lazy load goes
 * through `/api/orgunits`, which checks scope and depth again — so nothing
 * outside the user's access is reachable from here, by browsing or searching.
 */
export interface SelectorUnit {
  id: string;
  name: string;
  level: OrgLevel;
  parentId: string | null;
}

interface Item extends SelectorUnit {
  hasChildren: boolean;
}

interface SearchHit extends Item {
  path: Array<{ id: string; name: string }>;
}

export { LEVEL_LABEL };

const LEVEL_NUMBER: Record<OrgLevel, number> = { COUNTRY: 1, STATE: 2, LGA: 3, WARD: 4, FACILITY: 5 };
const ORDER: OrgLevel[] = ['COUNTRY', 'STATE', 'LGA', 'WARD', 'FACILITY'];

async function fetchNodes<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = (await response.json()) as { data?: T; error?: { message: string } };
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message ?? 'Could not load areas.');
  return payload.data;
}

export function OrgUnitSelector({
  units,
  path,
  value,
  deepestLevel,
  onSelect,
  label = 'Geography',
}: {
  /** Units the server has already resolved for this user (federal, state and LGA). */
  units: SelectorUnit[];
  /** The selected unit's ancestry, top first, inclusive. */
  path: Array<{ id: string; name: string; level: OrgLevel }>;
  value: string;
  deepestLevel: OrgLevel;
  onSelect: (id: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [levelFilter, setLevelFilter] = useState<OrgLevel | ''>('');
  // Results are kept with the query they answer, so a stale answer is never shown for a new query.
  const [answer, setAnswer] = useState<{ query: string; hits: SearchHit[] } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(path.slice(0, -1).map((unit) => unit.id)));
  const [loaded, setLoaded] = useState<Record<string, Item[] | 'loading' | 'error'>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const deepest = LEVEL_NUMBER[deepestLevel];

  const seeded = useMemo(() => {
    const byParent = new Map<string | null, Item[]>();
    const ids = new Set(units.map((unit) => unit.id));
    for (const unit of units) {
      // A unit whose parent is outside the user's access is a root of their tree.
      const parent = unit.parentId && ids.has(unit.parentId) ? unit.parentId : null;
      const node: Item = {
        ...unit,
        hasChildren: unit.level !== 'FACILITY' && LEVEL_NUMBER[unit.level] < deepest,
      };
      byParent.set(parent, [...(byParent.get(parent) ?? []), node]);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return byParent;
  }, [units, deepest]);

  const childrenOf = useCallback(
    (node: Item): Item[] | 'loading' | 'error' | undefined => {
      const seededChildren = seeded.get(node.id);
      if (seededChildren && seededChildren.length > 0) return seededChildren;
      return loaded[node.id];
    },
    [seeded, loaded],
  );

  const load = useCallback(
    (node: Item) => {
      if (seeded.get(node.id)?.length || loaded[node.id]) return;
      setLoaded((current) => ({ ...current, [node.id]: 'loading' }));
      fetchNodes<Array<Item & { levelNumber: number }>>(`/api/orgunits?parent=${encodeURIComponent(node.id)}`)
        .then((children) =>
          setLoaded((current) => ({
            ...current,
            [node.id]: children.sort((a, b) => a.name.localeCompare(b.name)),
          })),
        )
        .catch(() => setLoaded((current) => ({ ...current, [node.id]: 'error' })));
    },
    [seeded, loaded],
  );

  // Lazy branches on the selected path are loaded as the tree opens, so the
  // selection is visible in place even when it is a ward or a facility.
  const openPanel = () => {
    setOpen(true);
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    for (const unit of path.slice(0, -1)) {
      const known = byId.get(unit.id);
      if (known && seeded.get(unit.id)?.length) continue;
      load({ id: unit.id, name: unit.name, level: unit.level, parentId: known?.parentId ?? null, hasChildren: true });
    }
  };

  // Search runs on the server against the user's own scope.
  const needle = text.trim();
  const queryKey = `/api/orgunits?q=${encodeURIComponent(needle)}${levelFilter ? `&level=${levelFilter}` : ''}`;
  useEffect(() => {
    if (needle.length < 2) return;
    const timer = setTimeout(() => {
      fetchNodes<SearchHit[]>(queryKey)
        .then((result) => {
          setAnswer({ query: queryKey, hits: result });
          setSearchError(null);
        })
        .catch((error: Error) => {
          setAnswer({ query: queryKey, hits: [] });
          setSearchError(error.message);
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [needle, queryKey]);
  const hits = answer && answer.query === queryKey ? answer.hits : null;

  // Close on outside click and Escape; focus returns to the trigger.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as globalThis.Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const choose = (id: string) => {
    setOpen(false);
    setText('');
    if (id !== value) onSelect(id);
    triggerRef.current?.focus();
  };

  const toggle = (node: Item) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id);
      else {
        next.add(node.id);
        load(node);
      }
      return next;
    });
  };

  // Visible rows in order, for arrow-key navigation through the tree.
  const visible: Array<{ node: Item; depth: number }> = [];
  const walk = (nodes: Item[], depth: number) => {
    for (const node of nodes) {
      visible.push({ node, depth });
      const children = childrenOf(node);
      if (expanded.has(node.id) && Array.isArray(children)) walk(children, depth + 1);
    }
  };
  walk(seeded.get(null) ?? [], 0);

  const onTreeKey = (event: React.KeyboardEvent, node: Item) => {
    const index = visible.findIndex((entry) => entry.node.id === node.id);
    const move = (target: number) => {
      const entry = visible[Math.max(0, Math.min(visible.length - 1, target))];
      if (entry) {
        setFocusId(entry.node.id);
        treeRef.current?.querySelector<HTMLElement>(`[data-node="${entry.node.id}"]`)?.focus();
      }
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(visible.length - 1);
    else if (event.key === 'ArrowRight') {
      if (node.hasChildren && !expanded.has(node.id)) toggle(node);
      else move(index + 1);
    } else if (event.key === 'ArrowLeft') {
      if (expanded.has(node.id)) toggle(node);
      else {
        const parent = visible.findIndex((entry) => entry.node.id === node.parentId);
        if (parent >= 0) move(parent);
      }
    } else if (event.key === 'Enter' || event.key === ' ') choose(node.id);
    else if (event.key === 'Escape') {
      setOpen(false);
      triggerRef.current?.focus();
    } else return;
    event.preventDefault();
  };

  const current = path[path.length - 1];
  const permittedLevels = ORDER.slice(0, ORDER.indexOf(deepestLevel) + 1);

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1">
      <span className="text-[11px] font-medium text-[var(--text-tertiary)]" id={`${panelId}-label`}>
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-labelledby={`${panelId}-label ${panelId}-value`}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        className="flex h-8 w-[260px] max-w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border bg-[var(--surface)] px-2.5 text-left text-[13px] transition-colors duration-150 hover:border-[var(--border-strong)]"
      >
        <span id={`${panelId}-value`} className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-medium">{current?.name ?? 'Choose an area'}</span>
          {current ? (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
              {LEVEL_LABEL[current.level]}
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" className="text-[var(--text-tertiary)]">
          ▾
        </span>
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Choose a geography"
          className="absolute left-0 top-full z-40 mt-1.5 w-[min(380px,calc(100vw-32px))] rounded-[var(--radius-lg)] border bg-[var(--surface-raised)] p-2.5 shadow-[var(--shadow-lg)]"
        >
          <div className="flex gap-2">
            <label className="sr-only" htmlFor={`${panelId}-search`}>
              Find an area by name
            </label>
            <input
              id={`${panelId}-search`}
              ref={searchRef}
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setOpen(false);
                  triggerRef.current?.focus();
                }
                if (event.key === 'ArrowDown' && !hits) {
                  event.preventDefault();
                  treeRef.current?.querySelector<HTMLElement>('[data-node]')?.focus();
                }
              }}
              placeholder="Find an area by name"
              className="h-8 min-w-0 flex-1 rounded-[var(--radius-md)] border bg-[var(--surface)] px-2.5 text-[13px]"
            />
            <label className="sr-only" htmlFor={`${panelId}-level`}>
              Level
            </label>
            <select
              id={`${panelId}-level`}
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value as OrgLevel | '')}
              className="h-8 rounded-[var(--radius-md)] border bg-[var(--surface)] px-1.5 text-[12px]"
            >
              <option value="">All levels</option>
              {permittedLevels.map((level) => (
                <option key={level} value={level}>
                  Level {LEVEL_NUMBER[level]} · {LEVEL_LABEL[level]}
                </option>
              ))}
            </select>
          </div>

          {path.length > 1 ? (
            <nav aria-label="Selected area" className="mt-2 px-1 text-[11px] text-[var(--text-tertiary)]">
              {path.map((unit, index) => (
                <span key={unit.id}>
                  {index > 0 ? <span aria-hidden="true"> › </span> : null}
                  <button
                    type="button"
                    onClick={() => choose(unit.id)}
                    className={cn('hover:text-[var(--brand-600)] hover:underline', index === path.length - 1 && 'font-medium text-[var(--text-secondary)]')}
                  >
                    {unit.name}
                  </button>
                </span>
              ))}
            </nav>
          ) : null}

          <div className="mt-2 max-h-[min(380px,60dvh)] overflow-y-auto rounded-[var(--radius-md)] border py-1">
            {needle.length >= 2 ? (
              hits === null ? (
                <p className="px-3 py-2 text-[12px] text-[var(--text-tertiary)]">Searching…</p>
              ) : hits.length === 0 ? (
                <p className="px-3 py-2 text-[12px] text-[var(--text-tertiary)]">
                  {searchError ?? 'No area in your access matches that name.'}
                </p>
              ) : (
                <ul role="listbox" aria-label="Matching areas">
                  {hits.map((hit) => (
                    <li key={hit.id} role="option" aria-selected={hit.id === value}>
                      <button
                        type="button"
                        onClick={() => choose(hit.id)}
                        className={cn(
                          'flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-[var(--surface-sunken)] focus-visible:bg-[var(--surface-sunken)]',
                          hit.id === value && 'bg-[var(--brand-050)]',
                        )}
                      >
                        <span className="flex items-baseline gap-1.5 text-[13px]">
                          <span className="font-medium">{hit.name}</span>
                          <span className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                            {LEVEL_LABEL[hit.level]}
                          </span>
                        </span>
                        {hit.path.length > 0 ? (
                          <span className="text-[11px] text-[var(--text-tertiary)]">
                            {hit.path.map((ancestor) => ancestor.name).join(' › ')}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <ul ref={treeRef} role="tree" aria-label="Organisation units">
                {renderBranch(seeded.get(null) ?? [], 0)}
              </ul>
            )}
          </div>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            Open an area to see the areas beneath it; choose any level to report on it.
          </p>
        </div>
      ) : null}
    </div>
  );

  function renderBranch(nodes: Item[], depth: number): React.ReactNode {
    return nodes.map((node) => {
      const isOpen = expanded.has(node.id);
      const children = childrenOf(node);
      const selected = node.id === value;
      const tabbable = focusId ? focusId === node.id : selected || (depth === 0 && !path.some((unit) => unit.id === value));
      return (
        <li
          key={node.id}
          role="treeitem"
          aria-expanded={node.hasChildren ? isOpen : undefined}
          aria-selected={selected}
          aria-level={depth + 1}
        >
          <div
            className={cn(
              'group flex items-center gap-1 pr-2 text-[13px]',
              selected ? 'bg-[var(--brand-050)]' : 'hover:bg-[var(--surface-sunken)]',
            )}
            style={{ paddingLeft: 6 + depth * 16 }}
          >
            {node.hasChildren ? (
              <button
                type="button"
                tabIndex={-1}
                onClick={() => toggle(node)}
                aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--ink-100)]"
              >
                <span aria-hidden="true" className={cn('inline-block transition-transform motion-reduce:transition-none', isOpen && 'rotate-90')}>
                  ›
                </span>
              </button>
            ) : (
              <span className="w-6 shrink-0" />
            )}
            <button
              type="button"
              data-node={node.id}
              tabIndex={tabbable ? 0 : -1}
              onFocus={() => setFocusId(node.id)}
              onClick={() => choose(node.id)}
              onKeyDown={(event) => onTreeKey(event, node)}
              className="flex min-w-0 flex-1 items-baseline gap-1.5 rounded px-1 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-400)]"
            >
              <span className={cn('truncate', selected && 'font-semibold')}>{node.name}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
                {LEVEL_LABEL[node.level]}
              </span>
            </button>
          </div>
          {isOpen && node.hasChildren ? (
            children === 'loading' || children === undefined ? (
              <p className="py-1 text-[11px] text-[var(--text-tertiary)]" style={{ paddingLeft: 34 + depth * 16 }}>
                Loading…
              </p>
            ) : children === 'error' ? (
              <p className="py-1 text-[11px] text-[var(--concern-600)]" style={{ paddingLeft: 34 + depth * 16 }}>
                Could not load the areas beneath {node.name}.
              </p>
            ) : children.length === 0 ? (
              <p className="py-1 text-[11px] text-[var(--text-tertiary)]" style={{ paddingLeft: 34 + depth * 16 }}>
                No areas beneath {node.name}.
              </p>
            ) : (
              <ul role="group">{renderBranch(children, depth + 1)}</ul>
            )
          ) : null}
        </li>
      );
    });
  }
}
