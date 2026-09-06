import { seedRegistryIfEmpty } from './repositories/registry';
import { countUsers, createUser } from './repositories/users';
import { getDb } from './db/client';
import { runSync } from './sync/orchestrator';
import { recordAudit } from './repositories/audit';

/**
 * First-run preparation.
 *
 * Creates the schema, seeds the indicator registry and the provisional
 * methodology, creates the initial accounts, and performs the first
 * synchronisation so the platform is never showing an empty shell on a fresh
 * installation.
 *
 * Runs at most once per process; concurrent callers await the same promise.
 */
declare global {
  var __aspireBootstrap: Promise<void> | undefined;
}

/**
 * Initial accounts. Passwords come from the environment where set; otherwise a
 * documented development default is used, and the platform says so on the
 * sign-in screen rather than shipping a silent credential.
 */
const DEV_PASSWORD = process.env.ASPIRE_SEED_PASSWORD ?? 'aspire-demo';

const SEED_USERS = [
  {
    email: 'executive@aspire.local',
    name: 'Demo executive',
    role: 'EXECUTIVE' as const,
    scope: [] as string[],
  },
  {
    email: 'analyst@aspire.local',
    name: 'Demo programme officer',
    role: 'ANALYST' as const,
    scope: [] as string[],
  },
  {
    email: 'admin@aspire.local',
    name: 'Demo administrator',
    role: 'ADMIN' as const,
    scope: [] as string[],
  },
];

async function bootstrap(): Promise<void> {
  getDb();
  seedRegistryIfEmpty();

  if (countUsers() === 0) {
    for (const user of SEED_USERS) {
      createUser({ ...user, password: DEV_PASSWORD });
    }
    recordAudit({ action: 'system.seed_users', detail: `Created ${SEED_USERS.length} initial accounts.` });
  }

  const hasData = (getDb().prepare('SELECT COUNT(*) AS n FROM observations').get() as { n: number }).n > 0;
  if (!hasData) {
    const result = await runSync();
    recordAudit({
      action: 'system.initial_sync',
      detail: result.ok ? result.message : `Initial synchronisation failed: ${result.message}`,
    });
  }
}

export function ensureBootstrapped(): Promise<void> {
  if (!globalThis.__aspireBootstrap) {
    globalThis.__aspireBootstrap = bootstrap();
  }
  return globalThis.__aspireBootstrap;
}

export const SEED_ACCOUNTS = SEED_USERS.map((user) => ({ email: user.email, role: user.role }));
export const SEED_PASSWORD_IS_DEFAULT = process.env.ASPIRE_SEED_PASSWORD === undefined;
export const SEED_DEFAULT_PASSWORD = DEV_PASSWORD;
