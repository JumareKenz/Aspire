/**
 * Runs a synchronisation from the configured source and prints the outcome.
 * Intended for a scheduled job as well as manual use; exits non-zero on failure.
 */
import { ensureBootstrapped } from '../src/data/bootstrap';
import { runSync } from '../src/data/sync/orchestrator';

async function main() {
  await ensureBootstrapped();
  const result = await runSync();
  console.log(`${result.ok ? 'OK' : 'FAILED'} [${result.mode}] ${result.message}`);
  console.log(`  org units:    ${result.orgUnits}`);
  console.log(`  observations: ${result.observations}`);
  console.log(`  findings:     ${result.findings}`);
  if (!result.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
