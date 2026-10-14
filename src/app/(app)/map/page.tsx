import type { Metadata } from 'next';
import { resolvePageContext, type SearchParams } from '@/services/context';
import { getMapData } from '@/services/geography';
import { PageHeader } from '@/design/patterns/PageHeader';
import { ScopeBar } from '@/design/patterns/ScopeBar';
import { EmptyState } from '@/design/primitives/States';
import { Badge } from '@/design/primitives/Badge';
import { MapCanvas } from './MapCanvas';

export const metadata: Metadata = { title: 'Map' };
export const dynamic = 'force-dynamic';

export default async function MapPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const context = await resolvePageContext(await searchParams, { monthly: true });
  const data = await getMapData(context.orgUnit.id, context.periodId);

  return (
    <>
      <PageHeader
        title="Map"
        description={`Where the problems are within ${context.orgUnit.name}, ${context.periodLabel}.`}
        meta={
          data.mode === 'SCHEMATIC' ? (
            <Badge tone="warning" icon={<span aria-hidden="true">▲</span>}>
              Schematic layout
            </Badge>
          ) : (
            <Badge tone="neutral">Administrative boundaries</Badge>
          )
        }
        controls={
          <ScopeBar
            orgUnits={context.orgUnitOptions}
            periods={context.periodOptions}
            orgUnitPath={context.orgUnitPath}
            deepestLevel={context.deepestLevel}
            orgUnitId={context.orgUnit.id}
            periodId={context.periodId}
          />
        }
      />

      {data.units.length === 0 ? (
        <EmptyState
          title="Nothing to map at this level."
          description="This geography has no areas beneath it, or no positions are recorded for them. Choose a higher-level geography."
        />
      ) : (
        <MapCanvas data={data} periodId={context.periodId} />
      )}
    </>
  );
}
