/**
 * Runs the Intelligence evaluation set against the current dataset and prints
 * a pass/fail report. Exits non-zero on any failure so it can gate a release.
 */
import { ensureBootstrapped } from '../src/data/bootstrap';
import { runAllCases } from '../src/intelligence/evals/run';
import { listUsers } from '../src/data/repositories/users';
import { getRootOrgUnit } from '../src/data/repositories/orgUnits';
import { latestCompletePeriodId } from '../src/data/sync/periods';
import { getDataMode } from '../src/data/repositories/settings';

async function main() {
  await ensureBootstrapped();

  if (getDataMode() !== 'DEMO') {
    console.log('Evaluation cases describe the demo dataset. Current source is DHIS2 — skipping.');
    return;
  }

  const user = listUsers().find((entry) => entry.role === 'ANALYST');
  const root = getRootOrgUnit();
  if (!user || !root) throw new Error('Platform is not bootstrapped.');

  const outcomes = await runAllCases(user, {
    orgUnitId: root.id,
    periodId: latestCompletePeriodId(),
  });

  let failed = 0;
  for (const outcome of outcomes) {
    const mark = outcome.passed ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${outcome.case.id.padEnd(24)} ${outcome.case.question}`);
    if (!outcome.passed) {
      failed += 1;
      for (const failure of outcome.failures) console.log(`      ${failure}`);
    } else if (outcome.headline) {
      console.log(`      → ${outcome.headline}`);
    }
  }

  console.log(`\n${outcomes.length - failed}/${outcomes.length} cases passed.`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
