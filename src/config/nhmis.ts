import type { DataMode } from '@/core/model/types';
import type { ProvenanceException } from '@/core/registry/provenance';

/**
 * NHMIS data governance.
 *
 * The approved reporting scope is defined by forms, not by names: a data
 * element is NHMIS data when it sits on one of the forms below, as DHIS2's own
 * data set metadata records it at synchronisation. Every registry indicator is
 * checked against that catalogue (see `src/core/registry/provenance.ts`), and
 * only verified indicators are synchronised, scored, reported or offered for
 * target setting.
 *
 * Changing this list is a governance decision. Add a form only once the
 * programme has confirmed it as an approved NHMIS reporting form.
 */
export interface ApprovedForm {
  id: string;
  name: string;
  /** Who confirmed the form, and when, so the approval is traceable. */
  basis: string;
}

export const APPROVED_NHMIS_FORMS: ApprovedForm[] = [
  {
    id: 'O82o1WlMisO',
    name: 'NHMIS Monthly Summary Form (Version 2019)',
    basis:
      'Confirmed by the DHIS2 provider on 2026-09-29 as the NHMIS form shared with the platform, with completion records. The NHMIS 2025 form is not yet approved and is deliberately absent.',
  },
  {
    id: 'lyVV9bPLlVy',
    name: 'NHMIS Monthly Summary (version 2013)',
    basis:
      "Approved by the programme owner on 2026-10-14. The national instance's own indicator definitions for ANC timing, skilled birth attendance, postnatal care and HIV testing in ANC combine the 2013 and 2019 versions of the form; the 2013 elements hold well under 1% of values for Bauchi and Sokoto from 2025.",
  },
];

/**
 * Operands that are not NHMIS form data but are approved for a specific
 * indicator, each with its reason. Empty until the programme approves one:
 * an indicator whose definition draws on anything else — a population
 * estimate, a constant, a tracker programme — stays out of reporting and is
 * listed in Admin → Indicators with the operand that blocked it.
 */
export const NHMIS_PROVENANCE_EXCEPTIONS: ProvenanceException[] = [];

/** The synthetic form the demo dataset reports through. Never used against DHIS2. */
export const DEMO_FORM: ApprovedForm = {
  id: 'demo-nhmis-form',
  name: 'Demo form (synthetic)',
  basis: 'Synthetic data for development and review. Not NHMIS data.',
};

export function approvedFormsFor(mode: DataMode): ApprovedForm[] {
  return mode === 'DEMO' ? [DEMO_FORM] : APPROVED_NHMIS_FORMS;
}
