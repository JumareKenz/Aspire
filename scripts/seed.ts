/**
 * Prepares a fresh installation: creates the schema, seeds the indicator
 * registry and the provisional methodology, creates the initial accounts, and
 * performs the first synchronisation.
 *
 * Safe to re-run — it only fills in what is missing.
 */
import { ensureBootstrapped, SEED_ACCOUNTS, SEED_PASSWORD_IS_DEFAULT } from '../src/data/bootstrap';
import { getDataMode, getLastSyncAt } from '../src/data/repositories/settings';
import { listOrgUnits } from '../src/data/repositories/orgUnits';
import { listFindings } from '../src/data/repositories/findings';

async function main() {
  await ensureBootstrapped();
  console.log(`Data mode:       ${getDataMode()}`);
  console.log(`Org units:       ${listOrgUnits().length}`);
  console.log(`Open findings:   ${listFindings({ status: 'OPEN' }).length}`);
  console.log(`Last sync:       ${getLastSyncAt() ?? 'never'}`);
  console.log('\nAccounts:');
  for (const account of SEED_ACCOUNTS) console.log(`  ${account.email.padEnd(28)} ${account.role}`);
  if (SEED_PASSWORD_IS_DEFAULT) {
    console.log(
      '\nThese accounts use the documented development password. Set ASPIRE_SEED_PASSWORD before deploying.',
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
