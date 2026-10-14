import type { IndicatorDefinition } from './types';

/**
 * NHMIS provenance.
 *
 * The platform reports only figures that trace back to data elements on an
 * approved NHMIS form. That is decided here, from metadata, and never from a
 * name: a data element called "NHMIS adolescent …" that is not on an approved
 * form is not NHMIS data, and a DHIS2 indicator is not NHMIS merely because
 * some of its inputs are.
 *
 * An indicator is reduced to its operands — every data element, reporting rate,
 * constant or other source its value is computed from — and each operand is
 * checked:
 *
 *  - a data element (or one of its category option combos) is verified when it
 *    sits on an approved form;
 *  - a reporting rate is verified when its data set is an approved form;
 *  - `[days]` is the period length, not data, and needs no verification;
 *  - anything else — constants, organisation unit group counts, tracker
 *    program data, other indicators — is not NHMIS form data, and blocks the
 *    indicator unless an exception names it explicitly with a reason.
 *
 * The result is VERIFIED, APPROVED_EXCEPTION (verified except for operands an
 * exception approves), UNVERIFIED, or UNMAPPED (no source at all). Only the
 * first two enter the reporting workflow. Pure: every input is passed in.
 */

export type OperandKind =
  | 'DATA_ELEMENT'
  | 'REPORTING_RATE'
  | 'CONSTANT'
  | 'DAYS'
  | 'PROGRAM'
  | 'ORG_UNIT_GROUP'
  | 'INDICATOR'
  | 'UNKNOWN';

export type OperandRole = 'VALUE' | 'NUMERATOR' | 'DENOMINATOR' | 'BREAKDOWN';

export interface Operand {
  /** The reference as DHIS2 analytics takes it: "uid" or "uid.coc". */
  ref: string;
  kind: OperandKind;
  role: OperandRole;
  /** The data element's UID, for data element operands. */
  dataElementId: string | null;
  /** The category option combo, where the operand is one option of a data element. */
  optionComboId: string | null;
}

export interface VerifiedOperand extends Operand {
  verified: boolean;
  /** Display name, where the metadata provides one. */
  name: string | null;
  /** Approved forms carrying it. */
  forms: string[];
  /** The reason from the exception that approves it, if one does. */
  exception: string | null;
}

export type ProvenanceStatus = 'VERIFIED' | 'APPROVED_EXCEPTION' | 'UNVERIFIED' | 'UNMAPPED' | 'DEMO';

export interface IndicatorProvenance {
  indicatorId: string;
  status: ProvenanceStatus;
  /** How the value is obtained from the source. */
  sourceKind: 'DATA_ELEMENT' | 'SOURCE_INDICATOR' | 'CALCULATED' | null;
  /** The source indicator or data element's own name, where there is one. */
  sourceName: string | null;
  operands: VerifiedOperand[];
  /** Why the indicator is not verified, in words. Empty when it is. */
  reasons: string[];
}

export interface CatalogueEntry {
  id: string;
  name: string;
  formIds: string[];
}

export interface SourceIndicatorDefinition {
  id: string;
  name: string;
  numerator: string;
  denominator: string;
}

/** An explicit, reviewed approval of one operand that is not NHMIS form data. */
export interface ProvenanceException {
  indicatorId: string;
  /** The operand reference exactly as it appears, e.g. "C{abc123def45}" content or a data element UID. */
  ref: string;
  reason: string;
  approvedBy: string;
  approvedOn: string;
}

export interface ProvenanceContext {
  forms: Array<{ id: string; name: string }>;
  /** Data elements on approved forms, by UID. */
  catalogue: Map<string, CatalogueEntry>;
  /** DHIS2 indicators referenced by the registry, by UID. */
  sourceIndicators: Map<string, SourceIndicatorDefinition>;
  /** Display names for category option combos. */
  optionCombos?: Map<string, string>;
  exceptions: ProvenanceException[];
}

const UID = /^[A-Za-z][A-Za-z0-9]{10}$/;

/** "uid" or "uid.coc" split into its parts; null when it is not a well-formed reference. */
function splitRef(ref: string): { dataElementId: string; optionComboId: string | null } | null {
  const [de, coc, aoc] = ref.trim().split('.');
  if (!de || !UID.test(de)) return null;
  // "uid.*" and "uid.*.aoc" mean every option combo, i.e. the total.
  const option = coc && coc !== '*' ? coc : null;
  if (option && !UID.test(option)) return null;
  if (aoc && aoc !== '*' && !UID.test(aoc)) return null;
  return { dataElementId: de, optionComboId: option };
}

/**
 * The operands of a DHIS2 indicator expression.
 *
 * Covers the expression syntax DHIS2 indicators use: `#{de}`, `#{de.coc}`,
 * `#{de.coc.aoc}`, `#{de.*}`, `R{ds.METRIC}`, `C{constant}`, `OUG{group}`,
 * `D{program.de}`, `A{program.attribute}`, `I{programIndicator}`, `N{indicator}`
 * and `[days]`. Anything in braces that is not recognised is returned as
 * UNKNOWN rather than ignored, so it cannot slip through verification.
 */
export function parseExpression(expression: string, role: OperandRole): Operand[] {
  const operands: Operand[] = [];
  const pattern = /(OUG|#|R|C|D|A|I|N)\{([^}]*)\}|\[days\]|([A-Za-z_]+)\{([^}]*)\}/g;
  for (const match of expression.matchAll(pattern)) {
    if (match[0] === '[days]') {
      operands.push({ ref: '[days]', kind: 'DAYS', role, dataElementId: null, optionComboId: null });
      continue;
    }
    if (match[3]) {
      operands.push({ ref: match[0], kind: 'UNKNOWN', role, dataElementId: null, optionComboId: null });
      continue;
    }
    const [prefix, body] = [match[1], match[2].trim()];
    if (prefix === '#') {
      const parts = splitRef(body);
      operands.push(
        parts
          ? {
              ref: parts.optionComboId ? `${parts.dataElementId}.${parts.optionComboId}` : parts.dataElementId,
              kind: 'DATA_ELEMENT',
              role,
              ...parts,
            }
          : { ref: match[0], kind: 'UNKNOWN', role, dataElementId: null, optionComboId: null },
      );
      continue;
    }
    const kind: OperandKind =
      prefix === 'R'
        ? 'REPORTING_RATE'
        : prefix === 'C'
          ? 'CONSTANT'
          : prefix === 'OUG'
            ? 'ORG_UNIT_GROUP'
            : prefix === 'N'
              ? 'INDICATOR'
              : 'PROGRAM';
    operands.push({ ref: `${prefix}{${body}}`, kind, role, dataElementId: null, optionComboId: null });
  }
  return operands;
}

/** Operands of a "uid+uid.coc" component list, as the registry writes calculated indicators. */
function componentOperands(expression: string | null, role: OperandRole): Operand[] {
  return (expression ?? '')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const parts = splitRef(part);
      return parts
        ? { ref: part, kind: 'DATA_ELEMENT' as const, role, ...parts }
        : { ref: part, kind: 'UNKNOWN' as const, role, dataElementId: null, optionComboId: null };
    });
}

function dataElementOperand(ref: string, role: OperandRole): Operand {
  const parts = splitRef(ref);
  return parts
    ? { ref, kind: 'DATA_ELEMENT', role, ...parts }
    : { ref, kind: 'UNKNOWN', role, dataElementId: null, optionComboId: null };
}

const KIND_REASON: Record<OperandKind, string> = {
  DATA_ELEMENT: 'is not on an approved NHMIS form',
  REPORTING_RATE: 'is a reporting rate for a data set that is not an approved NHMIS form',
  CONSTANT: 'is a configured constant, not NHMIS form data',
  DAYS: '',
  PROGRAM: 'comes from a tracker programme, not an NHMIS aggregate form',
  ORG_UNIT_GROUP: 'counts organisation units in a group, which is not NHMIS form data',
  INDICATOR: 'is another indicator, whose own inputs are not verified here',
  UNKNOWN: 'could not be read as a known kind of source',
};

/** Classifies one registry indicator against the approved NHMIS metadata. */
export function classifyIndicator(indicator: IndicatorDefinition, context: ProvenanceContext): IndicatorProvenance {
  const { source } = indicator;
  const reasons: string[] = [];
  let operands: Operand[] = [];
  let sourceKind: IndicatorProvenance['sourceKind'] = null;
  let sourceName: string | null = null;

  const calculated = !source.dx && Boolean(source.numeratorDx) && Boolean(source.denominatorDx);
  if (!source.dx && !calculated) {
    return { indicatorId: indicator.id, status: 'UNMAPPED', sourceKind: null, sourceName: null, operands: [], reasons: ['No data source is mapped.'] };
  }

  if (source.dx) {
    const parts = splitRef(source.dx);
    const definition = context.sourceIndicators.get(source.dx);
    if (parts && context.catalogue.has(parts.dataElementId)) {
      sourceKind = 'DATA_ELEMENT';
      sourceName = context.catalogue.get(parts.dataElementId)!.name;
      operands = [dataElementOperand(source.dx, 'VALUE')];
    } else if (definition) {
      sourceKind = 'SOURCE_INDICATOR';
      sourceName = definition.name;
      operands = [
        ...parseExpression(definition.numerator, 'NUMERATOR'),
        ...parseExpression(definition.denominator, 'DENOMINATOR'),
      ];
    } else {
      reasons.push(
        `${source.dx} is neither a data element on an approved NHMIS form nor an indicator the source could describe.`,
      );
    }
  } else {
    sourceKind = 'CALCULATED';
    operands = [
      ...componentOperands(source.numeratorDx, 'NUMERATOR'),
      ...componentOperands(source.denominatorDx, 'DENOMINATOR'),
    ];
  }
  if (source.breakdown) operands.push(dataElementOperand(source.breakdown.dx, 'BREAKDOWN'));

  const formIds = new Set(context.forms.map((form) => form.id));
  if (source.datasetId && !formIds.has(source.datasetId)) {
    reasons.push(`Its reporting form ${source.datasetId} is not an approved NHMIS form.`);
  }

  const exceptions = context.exceptions.filter((entry) => entry.indicatorId === indicator.id);
  let excepted = false;
  const verified: VerifiedOperand[] = operands.map((operand) => {
    let ok = false;
    let name: string | null = null;
    let forms: string[] = [];
    if (operand.kind === 'DATA_ELEMENT' && operand.dataElementId) {
      const entry = context.catalogue.get(operand.dataElementId);
      if (entry) {
        ok = true;
        forms = entry.formIds;
        const option = operand.optionComboId ? context.optionCombos?.get(operand.optionComboId) : null;
        name = option ? `${entry.name} — ${option}` : entry.name;
      }
    } else if (operand.kind === 'REPORTING_RATE') {
      const dataset = operand.ref.slice(2, -1).split('.')[0];
      ok = formIds.has(dataset);
    } else if (operand.kind === 'DAYS') {
      ok = true;
    }
    const exception = ok ? null : (exceptions.find((entry) => entry.ref === operand.ref) ?? null);
    if (exception) excepted = true;
    if (!ok && !exception) {
      reasons.push(`${operand.ref} (${operand.role.toLowerCase()}) ${KIND_REASON[operand.kind]}.`);
    }
    return { ...operand, verified: ok, name, forms, exception: exception?.reason ?? null };
  });

  if (sourceKind && !verified.some((operand) => operand.kind === 'DATA_ELEMENT' && operand.verified)) {
    reasons.push('Its definition does not draw on any data element from an approved NHMIS form.');
  }

  return {
    indicatorId: indicator.id,
    status: reasons.length > 0 ? 'UNVERIFIED' : excepted ? 'APPROVED_EXCEPTION' : 'VERIFIED',
    sourceKind,
    sourceName,
    operands: verified,
    reasons,
  };
}

/** Whether an indicator with this provenance may enter the reporting workflow. */
export function isReportable(status: ProvenanceStatus | null | undefined): boolean {
  return status === 'VERIFIED' || status === 'APPROVED_EXCEPTION' || status === 'DEMO';
}

/** The DHIS2 indicator UIDs the registry refers to, for fetching their definitions. */
export function referencedSourceIndicators(
  indicators: IndicatorDefinition[],
  catalogue: Map<string, CatalogueEntry>,
): string[] {
  return [
    ...new Set(
      indicators
        .map((indicator) => indicator.source.dx)
        .filter((dx): dx is string => Boolean(dx) && !catalogue.has(String(dx).split('.')[0])),
    ),
  ];
}
