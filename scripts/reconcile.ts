/**
 * Reconciles ASPIRE's stored figures against DHIS2's own; see
 * src/services/reconciliation.ts for what is compared and how.
 *
 *   npm run reconcile                 prints a summary and stores it for Admin
 *   npm run reconcile -- out.json     also writes every comparison as JSON
 *
 * Exits non-zero when any figure differs, so it can run after a sync in CI.
 */
import { writeFileSync } from 'node:fs';
import { closeDb } from '../src/data/db/client';
import { runReconciliation, saveReconciliation } from '../src/services/reconciliation';

async function main() {
  const result = await runReconciliation();
  await saveReconciliation(result);
  const { summary } = result;
  console.log(`Reconciled ${summary.indicators} indicators × ${summary.orgUnits} org units × ${result.periods.length} periods.`);
  console.log(`  values compared:             ${summary.compared}`);
  console.log(`  identical to DHIS2:          ${summary.matched}`);
  console.log(`  different:                   ${summary.mismatched}`);
  console.log(`  in DHIS2, missing in ASPIRE: ${summary.onlyDhis2}`);
  console.log(`  in ASPIRE, missing in DHIS2: ${summary.onlyAspire}`);
  for (const c of result.comparisons.filter((c) => c.result !== 'MATCH' && c.result !== 'BOTH_EMPTY').slice(0, 20)) {
    console.log(`  ${c.result.padEnd(11)} ${c.indicatorId} · ${c.orgUnitName} (${c.level}) · ${c.periodId}: ASPIRE ${c.aspire} vs DHIS2 ${c.dhis2}`);
  }
  const out = process.argv[2];
  if (out) {
    writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(`Wrote ${out}`);
  }
  if (summary.mismatched + summary.onlyDhis2 + summary.onlyAspire > 0) process.exitCode = 1;
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
