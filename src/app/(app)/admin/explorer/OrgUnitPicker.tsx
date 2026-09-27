'use client';

import { useEffect, useState } from 'react';
import type { TreeNode } from '@/services/explorer';
import { TextInput } from '@/design/primitives/Field';
import { cn } from '@/design/primitives/cn';
import { callApi } from './api';

export interface PickedUnit {
  id: string;
  name: string;
  level: TreeNode['level'];
}

const LEVEL_LABEL: Record<TreeNode['level'], string> = {
  COUNTRY: 'Federal',
  STATE: 'State',
  LGA: 'LGA',
  WARD: 'Ward',
  FACILITY: 'Facility',
};

/**
 * Choosing where. A tree that loads each area's children when it is opened,
 * starting from the top of the user's access, with a search box for reaching
 * a ward or facility by name without walking the tree.
 */
export function OrgUnitPicker({
  selected,
  onToggle,
}: {
  selected: PickedUnit[];
  onToggle: (unit: PickedUnit) => void;
}) {
  const [roots, setRoots] = useState<TreeNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [results, setResults] = useState<Array<TreeNode & { parentName: string | null }> | null>(null);

  useEffect(() => {
    callApi<TreeNode[]>('/api/admin/explorer/orgunits')
      .then(setRoots)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const needle = text.trim();
  const searching = needle.length >= 2;
  useEffect(() => {
    if (!searching) return;
    const timer = setTimeout(() => {
      callApi<Array<TreeNode & { parentName: string | null }>>(
        `/api/admin/explorer/orgunits?q=${encodeURIComponent(needle)}`,
      )
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [needle, searching]);

  const selectedIds = new Set(selected.map((unit) => unit.id));

  return (
    <div className="flex flex-col gap-2">
      <TextInput
        label="Find an area"
        hideLabel
        placeholder="Find an LGA, ward or facility"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="max-h-[300px] overflow-y-auto rounded-[var(--radius-md)] border py-1">
        {error ? <p className="px-3 py-2 text-[12px] text-[var(--concern-600)]">{error}</p> : null}
        {searching && results ? (
          results.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-[var(--text-tertiary)]">No area matches that name.</p>
          ) : (
            <ul>
              {results.map((unit) => (
                <li key={unit.id}>
                  <Row
                    unit={unit}
                    depth={0}
                    checked={selectedIds.has(unit.id)}
                    onToggle={onToggle}
                    hint={unit.parentName ? `in ${unit.parentName}` : undefined}
                  />
                </li>
              ))}
            </ul>
          )
        ) : roots === null ? (
          <p className="px-3 py-2 text-[12px] text-[var(--text-tertiary)]">Loading areas…</p>
        ) : (
          <ul>
            {roots.map((unit) => (
              <Branch key={unit.id} unit={unit} depth={0} selectedIds={selectedIds} onToggle={onToggle} initiallyOpen={roots.length <= 2} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Branch({
  unit,
  depth,
  selectedIds,
  onToggle,
  initiallyOpen = false,
}: {
  unit: TreeNode;
  depth: number;
  selectedIds: Set<string>;
  onToggle: (unit: PickedUnit) => void;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [children, setChildren] = useState<TreeNode[] | null>(null);

  useEffect(() => {
    if (!open || children !== null || !unit.hasChildren) return;
    callApi<TreeNode[]>(`/api/admin/explorer/orgunits?parent=${unit.id}`)
      .then(setChildren)
      .catch(() => setChildren([]));
  }, [open, children, unit]);

  return (
    <li>
      <Row
        unit={unit}
        depth={depth}
        checked={selectedIds.has(unit.id)}
        onToggle={onToggle}
        expandable={unit.hasChildren}
        open={open}
        onExpand={() => setOpen((value) => !value)}
      />
      {open && unit.hasChildren ? (
        children === null ? (
          <p className="py-1 text-[11px] text-[var(--text-tertiary)]" style={{ paddingLeft: 36 + depth * 16 }}>
            Loading…
          </p>
        ) : (
          <ul>
            {children.map((child) => (
              <Branch key={child.id} unit={child} depth={depth + 1} selectedIds={selectedIds} onToggle={onToggle} />
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}

function Row({
  unit,
  depth,
  checked,
  onToggle,
  expandable = false,
  open = false,
  onExpand,
  hint,
}: {
  unit: TreeNode;
  depth: number;
  checked: boolean;
  onToggle: (unit: PickedUnit) => void;
  expandable?: boolean;
  open?: boolean;
  onExpand?: () => void;
  hint?: string;
}) {
  return (
    <div
      className={cn('flex items-center gap-1.5 py-1 pr-2 text-[12px] hover:bg-[var(--surface-sunken)]', checked && 'bg-[var(--brand-050)]')}
      style={{ paddingLeft: 8 + depth * 16 }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${unit.name}`}
          className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--ink-100)]"
        >
          <span className={cn('inline-block transition-transform', open && 'rotate-90')}>›</span>
        </button>
      ) : (
        <span className="w-5" />
      )}
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <input type="checkbox" checked={checked} onChange={() => onToggle({ id: unit.id, name: unit.name, level: unit.level })} />
        <span className="truncate text-[var(--text-primary)]">{unit.name}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{LEVEL_LABEL[unit.level]}</span>
        {hint ? <span className="truncate text-[11px] text-[var(--text-tertiary)]">{hint}</span> : null}
      </label>
    </div>
  );
}
