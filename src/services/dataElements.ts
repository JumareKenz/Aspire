import type { OrgUnit } from '@/core/model/types';
import type { DomainDefinition, IndicatorDefinition } from '@/core/registry/types';
import type { IndicatorProvenance, OperandRole } from '@/core/registry/provenance';
import { isReportable } from '@/core/registry/provenance';
import { groupByDomain, orderDomains, type DomainGroup } from '@/core/registry/ordering';
import { parsePeriod } from '@/core/model/periods';
import { PRIORITY_DOMAIN_IDS } from '@/config/domains';
import { listDomains, listIndicators, listReportingIndicators } from '@/data/repositories/registry';
import { getDataElementValues, listCatalogue, listForms, listProvenance, type DataElementRecord } from '@/data/repositories/nhmis';
import { getDataMode } from '@/data/repositories/settings';

/**
 * Data elements: the NHMIS source counts behind the reported indicators.
 *
 * A data element is not an indicator. It has no target of its own and no
 * score, and several of them are often components of one calculated
 * indicator — so they are reported as values with their provenance and
 * availability, never as achievement against a target, and never added into
 * the performance figures (which are built from the indicators alone).
 */

export type ElementStatus = 'IN_USE' | 'CONFIGURED' | 'AVAILABLE' | 'EXCLUDED';

export interface CatalogueRow {
  id: string;
  name: string;
  code: string | null;
  /** The domain it is listed under. */
  domainId: string | null;
  /** Where that domain came from: an administrator's choice, or the indicators it feeds. */
  domainSource: 'CONFIGURED' | 'INDICATOR' | null;
  forms: Array<{ id: string; name: string }>;
  valueType: string | null;
  aggregationType: string | null;
  /** The reported indicators it is an operand of, and in what role. */
  usedBy: Array<{ indicatorId: string; name: string; role: OperandRole }>;
  status: ElementStatus;
  configActive: boolean | null;
  synthetic: boolean;
}

/** The indicators each data element feeds, from verified operands of reportable indicators. */
function usage(
  provenance: Map<string, IndicatorProvenance>,
  indicators: IndicatorDefinition[],
): Map<string, CatalogueRow['usedBy']> {
  const byId = new Map(indicators.map((indicator) => [indicator.id, indicator]));
  const result = new Map<string, CatalogueRow['usedBy']>();
  for (const entry of provenance.values()) {
    const indicator = byId.get(entry.indicatorId);
    if (!indicator || !isReportable(entry.status)) continue;
    for (const operand of entry.operands) {
      if (operand.kind !== 'DATA_ELEMENT' || !operand.verified || !operand.dataElementId) continue;
      const list = result.get(operand.dataElementId) ?? [];
      if (!list.some((use) => use.indicatorId === indicator.id && use.role === operand.role)) {
        list.push({ indicatorId: indicator.id, name: indicator.name, role: operand.role });
      }
      result.set(operand.dataElementId, list);
    }
  }
  return result;
}

function primaryDomain(
  usedBy: CatalogueRow['usedBy'],
  indicators: Map<string, IndicatorDefinition>,
  domains: DomainDefinition[],
): string | null {
  const ids = new Set(usedBy.map((use) => indicators.get(use.indicatorId)?.domainId).filter(Boolean));
  return orderDomains(domains, PRIORITY_DOMAIN_IDS).find((domain) => ids.has(domain.id))?.id ?? null;
}

function toRow(
  element: DataElementRecord,
  used: CatalogueRow['usedBy'],
  indicators: Map<string, IndicatorDefinition>,
  domains: DomainDefinition[],
  forms: Map<string, string>,
): CatalogueRow {
  const configured = element.config?.domainId ?? null;
  const derived = primaryDomain(used, indicators, domains);
  const status: ElementStatus =
    element.config && !element.config.active
      ? 'EXCLUDED'
      : used.length > 0
        ? 'IN_USE'
        : element.config?.active && configured
          ? 'CONFIGURED'
          : 'AVAILABLE';
  return {
    id: element.id,
    name: element.name,
    code: element.code,
    domainId: configured ?? derived,
    domainSource: configured ? 'CONFIGURED' : derived ? 'INDICATOR' : null,
    forms: element.formIds.map((id) => ({ id, name: forms.get(id) ?? id })),
    valueType: element.valueType,
    aggregationType: element.aggregationType,
    usedBy: used,
    status,
    configActive: element.config?.active ?? null,
    synthetic: element.synthetic,
  };
}

export interface CatalogueView {
  groups: Array<DomainGroup<CatalogueRow>>;
  domains: Array<Pick<DomainDefinition, 'id' | 'name'>>;
  forms: Array<{ id: string; name: string; synthetic: boolean }>;
  /** Elements on the approved forms in total, whether or not the platform uses them. */
  onForms: number;
  inScope: number;
  mode: 'DEMO' | 'DHIS2';
}

/**
 * The data element catalogue for administration: elements in the reporting
 * scope by default, or every element on the approved forms. Grouped by domain
 * with adolescent SRHR first, then alphabetically; each element appears once,
 * under its primary domain.
 */
export async function getDataElementCatalogue(options: { all?: boolean } = {}): Promise<CatalogueView> {
  const [catalogue, forms, provenance, indicators, domains, mode] = await Promise.all([
    listCatalogue(),
    listForms(),
    listProvenance(),
    listIndicators(),
    listDomains(),
    getDataMode(),
  ]);
  const activeForms = forms.filter((form) => form.active);
  const indicatorMap = new Map(indicators.map((indicator) => [indicator.id, indicator]));
  const used = usage(provenance, indicators);
  const formNames = new Map(activeForms.map((form) => [form.id, form.name]));
  const rows = catalogue
    // A synthetic catalogue left over from demo mode is not shown against DHIS2.
    .filter((element) => element.synthetic === (mode === 'DEMO'))
    .map((element) => toRow(element, used.get(element.id) ?? [], indicatorMap, domains, formNames));
  const inScope = rows.filter((row) => row.status === 'IN_USE' || row.status === 'CONFIGURED');
  return {
    groups: groupByDomain(options.all ? rows : inScope, domains, PRIORITY_DOMAIN_IDS),
    domains: orderDomains(domains, PRIORITY_DOMAIN_IDS).map(({ id, name }) => ({ id, name })),
    forms: activeForms.map(({ id, name, synthetic }) => ({ id, name, synthetic })),
    onForms: rows.length,
    inScope: inScope.length,
    mode,
  };
}

/** Levels data element values are held at. */
const VALUE_LEVELS = new Set(['COUNTRY', 'STATE', 'LGA']);

export type ValueStatus = 'REPORTED' | 'NO_VALUE' | 'NOT_ADDITIVE';

export interface ElementValueRow {
  id: string;
  name: string;
  value: number | null;
  status: ValueStatus;
  aggregationType: string | null;
  usedBy: Array<{ indicatorId: string; name: string; role: OperandRole }>;
  domainId: string | null;
}

export interface DataElementReport {
  orgUnitName: string;
  periodLabel: string;
  /** False where values are not held at this level; `reason` says why. */
  available: boolean;
  reason: string | null;
  groups: Array<DomainGroup<ElementValueRow>>;
  reported: number;
  total: number;
  synthetic: boolean;
}

/**
 * Values of the data elements in the reporting scope, for one area and period,
 * grouped by domain. A missing value is reported as missing, not as zero.
 */
export async function getDataElementReport(orgUnit: OrgUnit, periodId: string): Promise<DataElementReport> {
  const period = parsePeriod(periodId);
  const view = await getDataElementCatalogue();
  const rows = view.groups.flatMap((group) => group.items);
  const base = {
    orgUnitName: orgUnit.name,
    periodLabel: period.label,
    synthetic: view.mode === 'DEMO',
    total: rows.length,
  };
  if (!VALUE_LEVELS.has(orgUnit.level)) {
    return {
      ...base,
      available: false,
      reason: 'Data element values are held for the federal tier, states and LGAs. Choose an LGA or higher to see them.',
      groups: [],
      reported: 0,
    };
  }
  const values = await getDataElementValues(
    rows.map((row) => row.id),
    [orgUnit.id],
    [periodId],
  );
  // The federal figure exists only for additive elements; it is built from the states.
  const federal = orgUnit.level === 'COUNTRY' && view.mode === 'DHIS2';
  const valueRows: ElementValueRow[] = rows.map((row) => {
    const value = values.get(`${row.id}|${orgUnit.id}|${periodId}`) ?? null;
    const status: ValueStatus =
      value !== null ? 'REPORTED' : federal && row.aggregationType !== 'SUM' ? 'NOT_ADDITIVE' : 'NO_VALUE';
    return {
      id: row.id,
      name: row.name,
      value,
      status,
      aggregationType: row.aggregationType,
      usedBy: row.usedBy,
      domainId: row.domainId,
    };
  });
  return {
    ...base,
    available: true,
    reason: null,
    groups: groupByDomain(valueRows, view.domains, PRIORITY_DOMAIN_IDS),
    reported: valueRows.filter((row) => row.status === 'REPORTED').length,
  };
}

export interface ContributingElement {
  ref: string;
  name: string;
  role: OperandRole;
  value: number | null;
}

/**
 * The data elements each reported indicator is computed from, with their
 * values for one area and period — the evidence the breakdown panels show
 * beneath each indicator. They explain an indicator's value; they are not
 * separate terms in any score.
 */
export async function getContributingElements(
  orgUnit: OrgUnit,
  periodId: string,
): Promise<Record<string, ContributingElement[]>> {
  const [provenance, indicators] = await Promise.all([listProvenance(), listReportingIndicators()]);
  const result: Record<string, ContributingElement[]> = {};
  const refs = new Set<string>();
  for (const indicator of indicators) {
    const operands = (provenance.get(indicator.id)?.operands ?? []).filter(
      (operand) => operand.kind === 'DATA_ELEMENT' && operand.verified && operand.role !== 'BREAKDOWN',
    );
    result[indicator.id] = operands.map((operand) => ({
      ref: operand.ref,
      name: operand.name ?? operand.ref,
      role: operand.role,
      value: null,
    }));
    for (const operand of operands) refs.add(operand.ref);
  }
  if (!VALUE_LEVELS.has(orgUnit.level)) return result;
  const values = await getDataElementValues([...refs], [orgUnit.id], [periodId]);
  for (const list of Object.values(result)) {
    for (const entry of list) entry.value = values.get(`${entry.ref}|${orgUnit.id}|${periodId}`) ?? null;
  }
  return result;
}
