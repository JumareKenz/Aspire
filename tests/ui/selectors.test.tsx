// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/overview',
  useSearchParams: () => new URLSearchParams('orgUnit=lga-bauchi-darazo&period=2025Q4'),
}));

const { OrgUnitSelector } = await import('@/design/patterns/OrgUnitSelector');
const { ScopeBar } = await import('@/design/patterns/ScopeBar');

afterEach(() => {
  cleanup();
  push.mockReset();
  vi.unstubAllGlobals();
});

const units = [
  { id: 'root', name: 'ASPIRE-GAC Programme', level: 'COUNTRY' as const, parentId: null },
  { id: 'state-bauchi', name: 'Bauchi State', level: 'STATE' as const, parentId: 'root' },
  { id: 'state-sokoto', name: 'Sokoto State', level: 'STATE' as const, parentId: 'root' },
  { id: 'lga-bauchi-darazo', name: 'Darazo', level: 'LGA' as const, parentId: 'state-bauchi' },
  { id: 'lga-sokoto-binji', name: 'Binji', level: 'LGA' as const, parentId: 'state-sokoto' },
];
const path = [
  { id: 'root', name: 'ASPIRE-GAC Programme', level: 'COUNTRY' as const },
  { id: 'state-bauchi', name: 'Bauchi State', level: 'STATE' as const },
  { id: 'lga-bauchi-darazo', name: 'Darazo', level: 'LGA' as const },
];

describe('hierarchical organisation unit selector', () => {
  it('shows the selection, opens on its path, and expands and collapses by parent', () => {
    const onSelect = vi.fn();
    render(<OrgUnitSelector units={units} path={path} value="lga-bauchi-darazo" deepestLevel="LGA" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Geography.*Darazo/ }));
    const tree = screen.getByRole('tree');
    // The selected path is open; the sibling state is not.
    expect(within(tree).getByText('Darazo')).toBeTruthy();
    expect(within(tree).queryByText('Binji')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Sokoto State' }));
    expect(within(tree).getByText('Binji')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Sokoto State' }));
    expect(within(tree).queryByText('Binji')).toBeNull();
    // Any level can be chosen.
    fireEvent.click(within(tree).getByText('Bauchi State'));
    expect(onSelect).toHaveBeenCalledWith('state-bauchi');
  });

  it('supports the keyboard: arrows move, Right expands, Enter selects, Escape closes', () => {
    const onSelect = vi.fn();
    render(<OrgUnitSelector units={units} path={path} value="lga-bauchi-darazo" deepestLevel="LGA" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Geography/ }));
    const current = document.querySelector<HTMLElement>('[data-node="lga-bauchi-darazo"]')!;
    current.focus();
    fireEvent.keyDown(current, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-node')).toBe('state-sokoto');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    expect(screen.getByText('Binji')).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('state-sokoto');
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('lazy-loads children below the seeded levels through the scoped API', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: 'ward-1', name: 'Ward One', level: 'WARD', parentId: 'lga-bauchi-darazo', hasChildren: true, levelNumber: 4 }] })),
    );
    vi.stubGlobal('fetch', fetch);
    render(<OrgUnitSelector units={units} path={path} value="lga-bauchi-darazo" deepestLevel="FACILITY" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Geography/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Darazo' }));
    expect(await screen.findByText('Ward One')).toBeTruthy();
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('/api/orgunits?parent=lga-bauchi-darazo');
  });

  it('offers no expansion beyond the deepest level a user may read', () => {
    render(<OrgUnitSelector units={units} path={path} value="lga-bauchi-darazo" deepestLevel="LGA" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Geography/ }));
    expect(screen.queryByRole('button', { name: 'Expand Darazo' })).toBeNull();
  });
});

describe('reporting period selector', () => {
  const periods = [
    { id: '202512', label: 'December 2025', type: 'MONTHLY' as const },
    { id: '202511', label: 'November 2025', type: 'MONTHLY' as const },
    { id: '2025Q4', label: 'Q4 2025', type: 'QUARTERLY' as const },
    { id: '2025Q3', label: 'Q3 2025', type: 'QUARTERLY' as const },
  ];
  const scopeUnits = units.map((unit) => ({ ...unit, depth: 0 }));

  it('switches a quarter to its last month, and a month back to its quarter, keeping the area', () => {
    const { rerender } = render(
      <ScopeBar orgUnits={scopeUnits} periods={periods} orgUnitId="lga-bauchi-darazo" periodId="2025Q4" orgUnitPath={path} />,
    );
    expect(screen.getByLabelText('Quarter')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }));
    expect(push).toHaveBeenLastCalledWith('/overview?orgUnit=lga-bauchi-darazo&period=202512', { scroll: false });

    rerender(<ScopeBar orgUnits={scopeUnits} periods={periods} orgUnitId="lga-bauchi-darazo" periodId="202511" orgUnitPath={path} />);
    const month = screen.getByLabelText('Month') as HTMLSelectElement;
    expect([...month.options].map((option) => option.value)).toEqual(['202512', '202511']);
    fireEvent.click(screen.getByRole('radio', { name: 'Quarterly' }));
    expect(push).toHaveBeenLastCalledWith('/overview?orgUnit=lga-bauchi-darazo&period=2025Q4', { scroll: false });
  });

  it('shows no monthly option where no month is available', () => {
    render(<ScopeBar orgUnits={scopeUnits} periods={periods.slice(2)} orgUnitId="root" periodId="2025Q4" />);
    expect(screen.queryByRole('radio', { name: 'Monthly' })).toBeNull();
  });
});
