'use client';

import { useMemo, useState } from 'react';
import type { CatalogueItem } from '@/services/explorer';
import { Badge } from '@/design/primitives/Badge';
import { Select, TextInput } from '@/design/primitives/Field';
import { cn } from '@/design/primitives/cn';

const SHOWN = 80;

/**
 * Choosing what to measure. Indicators and data elements are separate lists,
 * as in DHIS2, each searchable by name or UID and filterable by group (or, for
 * data elements, by the form they are reported through). Items ASPIRE already
 * uses are marked, since they are the ones with a known meaning.
 */
export function DataPicker({
  items,
  selected,
  onToggle,
}: {
  items: CatalogueItem[];
  selected: CatalogueItem[];
  onToggle: (item: CatalogueItem) => void;
}) {
  const [kind, setKind] = useState<CatalogueItem['kind']>('INDICATOR');
  const [text, setText] = useState('');
  const [group, setGroup] = useState('');
  const [aspireOnly, setAspireOnly] = useState(false);

  const ofKind = useMemo(() => items.filter((item) => item.kind === kind), [items, kind]);
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of ofKind) {
      for (const name of kind === 'INDICATOR' ? item.groups : item.forms.length > 0 ? item.forms : item.groups) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]));
  }, [ofKind, kind]);

  const matches = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return ofKind.filter(
      (item) =>
        (!aspireOnly || item.usedBy) &&
        (!group || item.groups.includes(group) || item.forms.includes(group)) &&
        (!needle || item.name.toLowerCase().includes(needle) || item.id.toLowerCase() === needle),
    );
  }, [ofKind, text, group, aspireOnly]);

  const selectedIds = new Set(selected.map((item) => item.id));

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Kind of data" className="grid grid-cols-2 rounded-[var(--radius-md)] border p-0.5">
        {(['INDICATOR', 'DATA_ELEMENT'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={kind === value}
            onClick={() => {
              setKind(value);
              setGroup('');
            }}
            className={cn(
              'rounded-[calc(var(--radius-md)-2px)] px-2 py-1.5 text-[12px] font-medium transition-colors',
              kind === value
                ? 'bg-[var(--brand-600)] text-[var(--text-inverse)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--ink-100)]',
            )}
          >
            {value === 'INDICATOR' ? 'Indicators' : 'Data elements'}
          </button>
        ))}
      </div>

      <TextInput
        label="Search"
        hideLabel
        placeholder={kind === 'INDICATOR' ? 'Search indicators by name or UID' : 'Search data elements by name or UID'}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <Select label={kind === 'INDICATOR' ? 'Group' : 'Form or group'} hideLabel value={group} onChange={(event) => setGroup(event.target.value)}>
        <option value="">{kind === 'INDICATOR' ? 'All indicator groups' : 'All forms and groups'}</option>
        {groups.map(([name, count]) => (
          <option key={name} value={name}>
            {name} ({count})
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
        <input type="checkbox" checked={aspireOnly} onChange={(event) => setAspireOnly(event.target.checked)} />
        Only items ASPIRE uses
      </label>

      <p className="text-[11px] text-[var(--text-tertiary)]">
        {matches.length.toLocaleString('en-GB')} {kind === 'INDICATOR' ? 'indicators' : 'data elements'}
        {matches.length > SHOWN ? `, showing the first ${SHOWN}. Search to narrow the list.` : ''}
      </p>
      <ul className="max-h-[340px] overflow-y-auto rounded-[var(--radius-md)] border" aria-label="Available data">
        {matches.slice(0, SHOWN).map((item) => {
          const on = selectedIds.has(item.id);
          return (
            <li key={item.id} className="border-b last:border-b-0">
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-2 px-2.5 py-2 text-[12px] hover:bg-[var(--surface-sunken)]',
                  on && 'bg-[var(--brand-050)]',
                )}
              >
                <input type="checkbox" className="mt-0.5" checked={on} onChange={() => onToggle(item)} />
                <span className="min-w-0">
                  <span className="block leading-snug text-[var(--text-primary)]">{item.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
                    <span className="font-mono">{item.id}</span>
                    {item.type ? <span>{item.type}</span> : null}
                    {item.usedBy ? <Badge tone="brand">ASPIRE</Badge> : null}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
        {matches.length === 0 ? (
          <li className="px-3 py-4 text-[12px] text-[var(--text-tertiary)]">Nothing matches. Try another word or group.</li>
        ) : null}
      </ul>
    </div>
  );
}
