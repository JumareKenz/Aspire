import type { Dataset, Observation, OrgUnit, Period, ReportingRecord } from '@/core/model/types';
import type { IndicatorDefinition } from '@/core/registry/types';
import type { Operand } from '@/core/registry/provenance';
import { DATASETS } from '@/config/indicators';
import { DEMO_FORM } from '@/config/nhmis';
import type {
  ConnectionResult,
  DataElementValueRequest,
  FetchRequest,
  SourceAdapter,
  SourceDataElement,
  SourceMetadata,
} from '../port';
import { generateDemoData, type DemoDataset } from './generator';
import { buildDemoGeography } from './geography';

/** Synthetic data element ids behind a demo indicator's numerator and denominator. */
export function demoElementIds(indicator: Pick<IndicatorDefinition, 'id' | 'unit'>): { numerator: string; denominator: string | null } {
  return {
    numerator: `demo-${indicator.id}-n`,
    denominator: indicator.unit === 'COUNT' ? null : `demo-${indicator.id}-d`,
  };
}

/**
 * Demo source. Produces the synthetic dataset described in
 * `src/data/sources/demo/generator.ts` through exactly the same port the DHIS2
 * adapter implements, so switching between them changes nothing above this layer.
 *
 * Its "data elements" are the numerator and denominator counts the generator
 * builds each indicator from, on a synthetic form that is labelled as such.
 * They exercise the data element screens; they are not NHMIS data elements.
 */
export class DemoAdapter implements SourceAdapter {
  readonly mode = 'DEMO' as const;
  readonly label = 'Demo dataset';
  private indicators: IndicatorDefinition[] = [];
  private readonly generated = new Map<string, DemoDataset>();

  async testConnection(): Promise<ConnectionResult> {
    return { ok: true, message: 'Demo data source is available. Figures are synthetic.' };
  }

  async fetchOrgUnits(): Promise<OrgUnit[]> {
    return buildDemoGeography().all;
  }

  async fetchDatasets(): Promise<Dataset[]> {
    return DATASETS;
  }

  /** Generation is deterministic and not cheap, so each period window is generated once per sync. */
  private generate(indicators: IndicatorDefinition[], periods: Period[], datasets: Dataset[]): DemoDataset {
    const key = `${indicators.map((indicator) => indicator.id).join(',')}|${periods.map((period) => period.id).join(',')}|${datasets.map((set) => set.id).join(',')}`;
    let dataset = this.generated.get(key);
    if (!dataset) {
      dataset = generateDemoData(indicators, periods, datasets);
      this.generated.set(key, dataset);
    }
    return dataset;
  }

  async fetchObservations(request: FetchRequest): Promise<Observation[]> {
    this.indicators = request.indicators;
    return this.generate(request.indicators, request.periods, DATASETS).observations;
  }

  async fetchReporting(request: FetchRequest & { datasets: Dataset[] }): Promise<ReportingRecord[]> {
    return this.generate(request.indicators, request.periods, request.datasets).reporting;
  }

  async fetchMetadata(request: { indicators: IndicatorDefinition[] }): Promise<SourceMetadata> {
    this.indicators = request.indicators;
    const { dataElements, syntheticOperands } = demoCatalogue(request.indicators);
    return {
      forms: [{ id: DEMO_FORM.id, name: DEMO_FORM.name, periodType: 'Monthly' }],
      dataElements,
      sourceIndicators: [],
      optionCombos: {},
      syntheticOperands,
    };
  }

  /** The generator's numerator and denominator totals at federal, state and LGA level. */
  async fetchDataElementValues(
    request: DataElementValueRequest,
  ): Promise<Array<{ dx: string; orgUnitId: string; periodId: string; value: number }>> {
    const wanted = new Set(request.dx);
    const levels = new Set(['COUNTRY', 'STATE', 'LGA']);
    const units = new Set(request.orgUnits.filter((unit) => levels.has(unit.level)).map((unit) => unit.id));
    const { observations } = this.generate(this.indicators, request.periods, DATASETS);
    const byId = new Map(this.indicators.map((indicator) => [indicator.id, indicator]));
    const values: Array<{ dx: string; orgUnitId: string; periodId: string; value: number }> = [];
    for (const observation of observations) {
      if (observation.disaggregation || !units.has(observation.orgUnitId)) continue;
      const indicator = byId.get(observation.indicatorId);
      if (!indicator) continue;
      const ids = demoElementIds(indicator);
      const numerator = indicator.unit === 'COUNT' ? observation.value : observation.numerator;
      if (numerator !== null && wanted.has(ids.numerator)) {
        values.push({ dx: ids.numerator, orgUnitId: observation.orgUnitId, periodId: observation.periodId, value: Math.round(numerator) });
      }
      if (ids.denominator && observation.denominator !== null && wanted.has(ids.denominator)) {
        values.push({ dx: ids.denominator, orgUnitId: observation.orgUnitId, periodId: observation.periodId, value: Math.round(observation.denominator) });
      }
    }
    return values;
  }
}

function demoCatalogue(indicators: IndicatorDefinition[]): {
  dataElements: SourceDataElement[];
  syntheticOperands: Record<string, Operand[]>;
} {
  const dataElements: SourceDataElement[] = [];
  const syntheticOperands: Record<string, Operand[]> = {};
  for (const indicator of indicators) {
    const ids = demoElementIds(indicator);
    const element = (id: string, part: string): SourceDataElement => ({
      id,
      name: `${indicator.shortName}: ${part} (demo)`,
      shortName: null,
      code: null,
      valueType: 'INTEGER_ZERO_OR_POSITIVE',
      aggregationType: 'SUM',
      formIds: [DEMO_FORM.id],
      categories: [],
    });
    const operand = (id: string, role: Operand['role']): Operand => ({
      ref: id,
      kind: 'DATA_ELEMENT',
      role,
      dataElementId: id,
      optionComboId: null,
    });
    if (ids.denominator) {
      dataElements.push(element(ids.numerator, 'numerator'), element(ids.denominator, 'denominator'));
      syntheticOperands[indicator.id] = [operand(ids.numerator, 'NUMERATOR'), operand(ids.denominator, 'DENOMINATOR')];
    } else {
      dataElements.push(element(ids.numerator, 'count'));
      syntheticOperands[indicator.id] = [operand(ids.numerator, 'VALUE')];
    }
  }
  return { dataElements, syntheticOperands };
}
