import type { IndicatorDefinition } from '@/core/registry/types';
import {
  classifyIndicator,
  isReportable,
  type CatalogueEntry,
  type IndicatorProvenance,
} from '@/core/registry/provenance';
import { approvedFormsFor, NHMIS_PROVENANCE_EXCEPTIONS } from '@/config/nhmis';
import type { SourceAdapter, SourceMetadata } from '../sources/port';

export interface GovernanceResult {
  metadata: SourceMetadata;
  /** Approved forms the source actually holds. */
  forms: SourceMetadata['forms'];
  provenance: IndicatorProvenance[];
  /** Active indicators that passed verification — the only ones synchronised. */
  reportable: IndicatorDefinition[];
}

function optionCombosOf(indicators: IndicatorDefinition[]): string[] {
  const ids = new Set<string>();
  for (const indicator of indicators) {
    for (const part of [indicator.source.numeratorDx, indicator.source.denominatorDx, indicator.source.dx]) {
      for (const ref of (part ?? '').split('+')) {
        const coc = ref.trim().split('.')[1];
        if (coc && coc !== '*') ids.add(coc);
      }
    }
  }
  return [...ids];
}

/**
 * Verifies every registry indicator against the approved forms' metadata, as
 * the source reports it at this synchronisation.
 *
 * Every mapped `dx` is asked for as an indicator definition; data element
 * UIDs simply come back empty, so nothing about the UID has to be guessed.
 */
export async function verifyProvenance(
  adapter: SourceAdapter,
  registry: IndicatorDefinition[],
): Promise<GovernanceResult> {
  const approved = approvedFormsFor(adapter.mode);
  const metadata = await adapter.fetchMetadata({
    indicators: registry,
    formIds: approved.map((form) => form.id),
    sourceIndicatorIds: [...new Set(registry.map((indicator) => indicator.source.dx).filter((dx): dx is string => Boolean(dx)))],
    optionComboIds: optionCombosOf(registry),
  });
  const approvedIds = new Set(approved.map((form) => form.id));
  // Only forms that are both approved and actually present at the source count.
  const forms = metadata.forms.filter((form) => approvedIds.has(form.id));
  const formIds = new Set(forms.map((form) => form.id));
  const catalogue = new Map<string, CatalogueEntry>(
    metadata.dataElements
      .map((element) => ({ ...element, formIds: element.formIds.filter((id) => formIds.has(id)) }))
      .filter((element) => element.formIds.length > 0)
      .map((element) => [element.id, { id: element.id, name: element.name, formIds: element.formIds }]),
  );

  const provenance: IndicatorProvenance[] = registry.map((indicator) => {
    if (metadata.syntheticOperands) {
      const operands = metadata.syntheticOperands[indicator.id] ?? [];
      return {
        indicatorId: indicator.id,
        status: 'DEMO',
        sourceKind: 'CALCULATED',
        sourceName: null,
        operands: operands.map((operand) => ({
          ...operand,
          verified: catalogue.has(operand.dataElementId ?? ''),
          name: catalogue.get(operand.dataElementId ?? '')?.name ?? null,
          forms: catalogue.get(operand.dataElementId ?? '')?.formIds ?? [],
          exception: null,
        })),
        reasons: [],
      };
    }
    return classifyIndicator(indicator, {
      forms,
      catalogue,
      sourceIndicators: new Map(metadata.sourceIndicators.map((definition) => [definition.id, definition])),
      optionCombos: new Map(Object.entries(metadata.optionCombos)),
      exceptions: NHMIS_PROVENANCE_EXCEPTIONS,
    });
  });

  const statusById = new Map(provenance.map((entry) => [entry.indicatorId, entry.status]));
  return {
    metadata,
    forms,
    provenance,
    reportable: registry.filter((indicator) => indicator.active && isReportable(statusById.get(indicator.id))),
  };
}

/**
 * The data element references whose values are stored for reporting: every
 * verified data element operand of a reportable indicator (with its option,
 * where the indicator uses one option), each element's total, and any element
 * an administrator has added to reporting.
 */
export function dataElementRefs(provenance: IndicatorProvenance[], reportableIds: Set<string>, configured: string[]): string[] {
  const refs = new Set<string>(configured);
  for (const entry of provenance) {
    if (!reportableIds.has(entry.indicatorId)) continue;
    for (const operand of entry.operands) {
      if (operand.kind !== 'DATA_ELEMENT' || !operand.verified || !operand.dataElementId) continue;
      refs.add(operand.dataElementId);
      if (operand.optionComboId) refs.add(operand.ref);
    }
  }
  return [...refs].sort();
}
