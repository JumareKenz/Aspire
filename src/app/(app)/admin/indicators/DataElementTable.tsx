'use client';

import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CatalogueRow, CatalogueView, ElementStatus } from '@/services/dataElements';
import { TableWrap, Td, Th, Tr } from '@/design/primitives/Table';
import { Badge, type Tone } from '@/design/primitives/Badge';
import { Button } from '@/design/primitives/Button';
import { Drawer } from '@/design/primitives/Drawer';
import { Select, TextInput } from '@/design/primitives/Field';

const STATUS_META: Record<ElementStatus, { label: string; tone: Tone }> = {
  IN_USE: { label: 'In use', tone: 'positive' },
  CONFIGURED: { label: 'Added to reporting', tone: 'info' },
  AVAILABLE: { label: 'On form, not used', tone: 'neutral' },
  EXCLUDED: { label: 'Excluded', tone: 'warning' },
};

const ROLE: Record<string, string> = { NUMERATOR: 'numerator', DENOMINATOR: 'denominator', VALUE: 'value', BREAKDOWN: 'split' };

function typeLabel(row: CatalogueRow): string {
  const value = row.valueType
    ? row.valueType.startsWith('INTEGER')
      ? 'Count'
      : row.valueType.charAt(0) + row.valueType.slice(1).toLowerCase().replace(/_/g, ' ')
    : '—';
  return row.aggregationType ? `${value} · ${row.aggregationType.toLowerCase().replace(/_/g, ' ')}` : value;
}

/**
 * The NHMIS data elements behind the platform's indicators.
 *
 * Every row is a data element DHIS2 records on an approved NHMIS form; the
 * list cannot hold anything else, because it is built from the forms' own
 * metadata at synchronisation. Grouped by domain — adolescent SRHR first,
 * then alphabetically — with each element once, under its primary domain.
 * Source metadata is read-only; the domain and inclusion are the platform's
 * configuration and are editable by administrators.
 */
export function DataElementTable({ catalogue, canManage }: { catalogue: CatalogueView; canManage: boolean }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [domain, setDomain] = useState('');
  const [scope, setScope] = useState<'reporting' | 'all'>('reporting');
  const [sort, setSort] = useState<'name' | 'usage'>('name');
  const [editing, setEditing] = useState<CatalogueRow | null>(null);
  const [editDomain, setEditDomain] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domainName = new Map(catalogue.domains.map((entry) => [entry.id, entry.name]));

  const groups = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return catalogue.groups
      .filter((group) => !domain || (domain === 'none' ? group.domainId === null : group.domainId === domain))
      .map((group) => ({
        ...group,
        items: group.items
          .filter((row) => scope === 'all' || row.status === 'IN_USE' || row.status === 'CONFIGURED')
          .filter(
            (row) =>
              !needle ||
              row.name.toLowerCase().includes(needle) ||
              row.id.toLowerCase().includes(needle) ||
              (row.code ?? '').toLowerCase().includes(needle),
          )
          .sort((a, b) => (sort === 'usage' ? b.usedBy.length - a.usedBy.length : 0) || a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' })),
      }))
      .filter((group) => group.items.length > 0);
  }, [catalogue.groups, text, domain, scope, sort]);
  const shown = groups.reduce((sum, group) => sum + group.items.length, 0);

  function edit(row: CatalogueRow) {
    setEditing(row);
    setEditDomain(row.domainSource === 'CONFIGURED' ? (row.domainId ?? '') : '');
    setEditActive(row.status !== 'EXCLUDED');
    setError(null);
  }

  async function save() {
    if (!editing) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/data-elements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editing.id, domainId: editDomain || null, active: editActive }),
      });
      const payload = (await response.json()) as { error?: { message: string } };
      if (!response.ok) {
        setError(payload.error?.message ?? 'The change could not be saved.');
        return;
      }
      setEditing(null);
      router.refresh();
    } catch {
      setError('We could not reach the server. Try again in a moment.');
    } finally {
      setPending(false);
    }
  }

  if (catalogue.onForms === 0) {
    return (
      <p className="px-2 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
        No data elements are recorded yet. They are read from the approved NHMIS forms at the next synchronisation.
      </p>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <TextInput
          label="Search"
          placeholder="Name, UID or code"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="w-[240px]"
        />
        <Select label="Domain" value={domain} onChange={(event) => setDomain(event.target.value)} className="w-[200px]">
          <option value="">All domains</option>
          {catalogue.domains.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
          <option value="none">Not assigned</option>
        </Select>
        <Select label="Show" value={scope} onChange={(event) => setScope(event.target.value as 'reporting' | 'all')} className="w-[230px]">
          <option value="reporting">In the reporting scope ({catalogue.inScope})</option>
          <option value="all">Everything on the forms ({catalogue.onForms})</option>
        </Select>
        <Select label="Sort within domain" value={sort} onChange={(event) => setSort(event.target.value as 'name' | 'usage')} className="w-[170px]">
          <option value="name">By name</option>
          <option value="usage">By indicators fed</option>
        </Select>
        <p className="mb-1.5 ml-auto text-[12px] text-[var(--text-tertiary)]" aria-live="polite">
          {shown} shown · forms: {catalogue.forms.map((form) => form.name).join(', ') || 'none'}
        </p>
      </div>

      {catalogue.mode === 'DEMO' ? (
        <p className="mb-3 text-[11px] text-[var(--warning-700)]">
          Demo data: these are the synthetic counts each demo indicator is generated from, on a synthetic form. Connected
          to DHIS2, this list is the NHMIS form&apos;s own data elements.
        </p>
      ) : null}

      {shown === 0 ? (
        <p className="px-2 py-8 text-center text-[13px] text-[var(--text-tertiary)]">No data element matches these filters.</p>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th width="32%">Data element</Th>
              <Th width="14%">Domain</Th>
              <Th width="16%">NHMIS form</Th>
              <Th width="12%">Type</Th>
              <Th width="16%">Feeds</Th>
              <Th width="10%">Status</Th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.domainId ?? 'none'}>
                <Tr className="bg-[var(--surface-sunken)]">
                  <Td colSpan={6} className="text-[12px] font-semibold">
                    {group.domainName}
                    <span className="ml-1.5 font-normal text-[var(--text-tertiary)]">{group.items.length}</span>
                  </Td>
                </Tr>
                {group.items.map((row) => (
                  <Tr key={row.id} interactive={canManage}>
                    <Td className="text-[12px]">
                      {canManage ? (
                        <button type="button" onClick={() => edit(row)} className="text-left font-medium hover:text-[var(--brand-600)] hover:underline">
                          {row.name}
                        </button>
                      ) : (
                        <span className="font-medium">{row.name}</span>
                      )}
                      <span className="mt-0.5 block font-mono text-[10px] text-[var(--text-tertiary)]">
                        {row.id}
                        {row.code ? ` · ${row.code}` : ''}
                      </span>
                    </Td>
                    <Td className="text-[12px] text-[var(--text-secondary)]">
                      {row.domainId ? domainName.get(row.domainId) : '—'}
                      {row.domainSource === 'CONFIGURED' ? (
                        <span className="block text-[10px] text-[var(--text-tertiary)]">set by administrator</span>
                      ) : null}
                    </Td>
                    <Td className="text-[11px] text-[var(--text-secondary)]">{row.forms.map((form) => form.name).join(', ')}</Td>
                    <Td className="text-[11px] text-[var(--text-secondary)]">{typeLabel(row)}</Td>
                    <Td className="text-[11px] text-[var(--text-secondary)]">
                      {row.usedBy.length === 0 ? '—' : row.usedBy.map((use) => `${use.name} (${ROLE[use.role] ?? use.role})`).join('; ')}
                    </Td>
                    <Td>
                      <Badge tone={STATUS_META[row.status].tone}>{STATUS_META[row.status].label}</Badge>
                    </Td>
                  </Tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </TableWrap>
      )}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.name ?? ''}
        description={editing ? `${editing.id} · ${editing.forms.map((form) => form.name).join(', ')}` : undefined}
        footer={
          editing ? (
            <div className="space-y-2">
              {error ? (
                <p role="alert" className="text-[12px] text-[var(--concern-600)]">
                  {error}
                </p>
              ) : null}
              <Button size="sm" variant="primary" disabled={pending} onClick={() => void save()}>
                {pending ? 'Saving…' : 'Save configuration'}
              </Button>
            </div>
          ) : null
        }
      >
        {editing ? (
          <div className="space-y-4 text-[12px]">
            <p className="leading-relaxed text-[var(--text-secondary)]">
              The name, UID, form and type come from DHIS2 and are not edited here. The domain it is reported under, and
              whether it appears in data element reporting, are the platform&apos;s own configuration. Values for a newly
              added element are fetched at the next synchronisation.
            </p>
            <Select label="Domain" value={editDomain} onChange={(event) => setEditDomain(event.target.value)}>
              <option value="">
                {editing.usedBy.length > 0 ? 'From the indicators it feeds' : 'Not assigned'}
              </option>
              {catalogue.domains.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={editActive} onChange={(event) => setEditActive(event.target.checked)} className="mt-0.5" />
              <span>
                Include in data element reporting
                <span className="block text-[11px] text-[var(--text-tertiary)]">
                  {editing.usedBy.length > 0
                    ? 'Excluding it hides it from data element reporting only. The indicators it feeds still use it.'
                    : 'An element not used by any indicator is reported only once it is included and has a domain.'}
                </span>
              </span>
            </label>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
