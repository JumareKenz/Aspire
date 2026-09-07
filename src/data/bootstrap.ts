import { seedRegistryIfEmpty } from './repositories/registry';
import { countUsers, createUser } from './repositories/users';
import { ensureSchema, queryOne, transaction } from './db/client';
import { env, envOr } from '@/lib/env';
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
const DEV_PASSWORD = envOr('ASPIRE_SEED_PASSWORD', 'aspire-demo');

/**
 * Initial accounts.
 *
 * Role and geographic scope are **independent**. Role says what a user may do;
 * scope says where they may do it. Every combination below is legitimate, and
 * the two are deliberately not correlated — there is no rule that executives
 * are global or that analysts are state-bound.
 *
 * An empty `scope` means global: both states and everything beneath them.
 * A scope naming a state restricts the user to that state's subtree, enforced
 * in the data layer rather than by hiding controls.
 */
const SEED_USERS = [
  {
    email: 'executive@aspire.local',
    name: 'Global executive',
    role: 'EXECUTIVE' as const,
    scope: [] as string[],
  },
  {
    email: 'bauchi.executive@aspire.local',
    name: 'Bauchi executive',
    role: 'EXECUTIVE' as const,
    scope: ['state-bauchi'],
  },
  {
    email: 'analyst@aspire.local',
    name: 'Global programme officer',
    role: 'ANALYST' as const,
    scope: [] as string[],
  },
  {
    email: 'bauchi.analyst@aspire.local',
    name: 'Bauchi programme officer',
    role: 'ANALYST' as const,
    scope: ['state-bauchi'],
  },
  {
    email: 'sokoto.analyst@aspire.local',
    name: 'Sokoto programme officer',
    role: 'ANALYST' as const,
    scope: ['state-sokoto'],
  },
  {
    email: 'admin@aspire.local',
    name: 'System administrator',
    role: 'ADMIN' as const,
    scope: [] as string[],
  },
];

/**
 * Identifier for the Postgres advisory lock that serialises first-run setup.
 * Arbitrary but fixed — it only has to be unique within this database.
 */
const BOOTSTRAP_LOCK = 48203311;

async function bootstrap(): Promise<void> {
  await ensureSchema();

  // Serverless platforms start many instances at once, and a cold start on
  // each would otherwise run seeding concurrently — duplicating accounts and
  // racing two synchronisations into the same tables. A session-level advisory
  // lock makes exactly one instance do the work while the others wait for it
  // and then observe the finished state.
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK]);
    await seedInside();
  });
}

async function seedInside(): Promise<void> {
  await seedRegistryIfEmpty();

  // Geography is imported before accounts, because a state-scoped account
  // references org unit ids that must already exist for its scope to resolve.
  const observations = await queryOne<{ n: string }>('SELECT COUNT(*) AS n FROM observations');
  if (Number(observations?.n ?? 0) === 0) {
    const result = await runSync();
    await recordAudit({
      action: 'system.initial_sync',
      detail: result.ok ? result.message : `Initial synchronisation failed: ${result.message}`,
    });
  }

  if ((await countUsers()) === 0) {
    for (const user of SEED_USERS) {
      await createUser({ ...user, password: DEV_PASSWORD });
    }
    await recordAudit({
      action: 'system.seed_users',
      detail: `Created ${SEED_USERS.length} initial accounts.`,
    });
  }

}

export function ensureBootstrapped(): Promise<void> {
  if (!globalThis.__aspireBootstrap) {
    // A failed bootstrap must not be cached as a permanently rejected promise,
    // or one transient database error would poison the instance for its whole
    // lifetime. Clearing it lets the next request try again.
    globalThis.__aspireBootstrap = bootstrap().catch((error) => {
      globalThis.__aspireBootstrap = undefined;
      throw error;
    });
  }
  return globalThis.__aspireBootstrap;
}

export const SEED_ACCOUNTS = SEED_USERS.map((user) => ({ email: user.email, role: user.role }));
export const SEED_PASSWORD_IS_DEFAULT = env('ASPIRE_SEED_PASSWORD') === undefined;
export const SEED_DEFAULT_PASSWORD = DEV_PASSWORD;
