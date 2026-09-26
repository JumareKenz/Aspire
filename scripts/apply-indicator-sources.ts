/**
 * Copies each indicator's DHIS2 mapping (`source`) from src/config/indicators.ts
 * into the database registry.
 *
 * The config only seeds an empty registry; after that the database is
 * authoritative. When the mappings in the config change — for example on
 * moving to a different DHIS2 instance, whose UIDs do not transfer — this brings
 * an existing installation in line without touching targets, scoring or any
 * other field an administrator may have edited, except the description: when a
 * mapping changes, what the indicator measures may change with it, so the
 * description is updated alongside. Run `npm run sync` afterwards.
 */
import { INDICATORS } from '../src/config/indicators';
import { getIndicator, saveIndicator, seedRegistryIfEmpty } from '../src/data/repositories/registry';
import { closeDb, ensureSchema } from '../src/data/db/client';

/** JSON with keys sorted: the database returns JSONB keys in its own order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

async function main() {
  await ensureSchema();
  await seedRegistryIfEmpty();
  for (const configured of INDICATORS) {
    const stored = await getIndicator(configured.id);
    if (!stored) {
      await saveIndicator(configured);
      console.log(`added    ${configured.id}`);
      continue;
    }
    const describe = (source: typeof configured.source) =>
      `${source.dx ?? (source.numeratorDx ? `${source.numeratorDx} ÷ ${source.denominatorDx}` : '—')} / ${source.datasetId ?? '—'}` +
      (source.breakdown ? ` / by ${source.breakdown.label.toLowerCase()}` : '');
    if (canonical(stored.source) === canonical(configured.source)) continue;
    const before = describe(stored.source);
    const after = describe(configured.source);
    await saveIndicator({ ...stored, source: configured.source, description: configured.description });
    console.log(`updated  ${configured.id}: ${before} → ${after}`);
  }
}

main()
  .then(() => closeDb())
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
