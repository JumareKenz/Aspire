import type { Dataset, Observation, OrgUnit, ReportingRecord } from '@/core/model/types';
import { DATASETS } from '@/config/indicators';
import type { ConnectionResult, FetchRequest, SourceAdapter } from '../port';
import { generateDemoData } from './generator';
import { buildDemoGeography } from './geography';

/**
 * Demo source. Produces the synthetic dataset described in
 * `src/data/sources/demo/generator.ts` through exactly the same port the DHIS2
 * adapter implements, so switching between them changes nothing above this layer.
 */
export class DemoAdapter implements SourceAdapter {
  readonly mode = 'DEMO' as const;
  readonly label = 'Demo dataset';

  async testConnection(): Promise<ConnectionResult> {
    return { ok: true, message: 'Demo data source is available. Figures are synthetic.' };
  }

  async fetchOrgUnits(): Promise<OrgUnit[]> {
    return buildDemoGeography().all;
  }

  async fetchDatasets(): Promise<Dataset[]> {
    return DATASETS;
  }

  async fetchObservations(request: FetchRequest): Promise<Observation[]> {
    return generateDemoData(request.indicators, request.periods, DATASETS).observations;
  }

  async fetchReporting(request: FetchRequest & { datasets: Dataset[] }): Promise<ReportingRecord[]> {
    return generateDemoData(request.indicators, request.periods, request.datasets).reporting;
  }
}
