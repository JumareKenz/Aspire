/**
 * Runs DHIS2's validation rules for every facility and month still
 * outstanding; see src/services/validationScorecard.ts.
 *
 *   npm run validate:facilities              works until nothing is left
 *   npm run validate:facilities -- 200       checks at most 200 facility-months
 *
 * Safe to stop and restart: each facility-month is recorded as it completes.
 */
import { closeDb, ensureSchema } from '../src/data/db/client';
import { getCoverage, runValidationBatch } from '../src/services/validationScorecard';

async function main() {
  await ensureSchema();
  const limit = process.argv[2] ? Number(process.argv[2]) : undefined;
  const before = await getCoverage();
  if (!before) throw new Error('No indicator names a form to validate.');
  console.log(
    `Form ${before.datasetId} · ${before.facilities} facilities × ${before.months.length} months (${before.months[0]}–${before.months.at(-1)}) · ${before.remaining} of ${before.total} to check`,
  );

  let stalled = 0;
  for (;;) {
    const result = await runValidationBatch({ budgetMs: 60_000, limit });
    console.log(`  checked ${result.checked} of ${result.total} (${result.done} this batch${result.failed ? `, ${result.failed} failed` : ''})`);
    if (result.remaining === 0 || limit) break;
    // DHIS2 not answering: give up after a few empty batches rather than loop.
    stalled = result.done === 0 ? stalled + 1 : 0;
    if (stalled >= 3) {
      console.error('DHIS2 is not answering; stopping. Run again to resume.');
      process.exitCode = 1;
      break;
    }
  }
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
