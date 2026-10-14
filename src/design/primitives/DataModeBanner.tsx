import { Badge } from './Badge';

/**
 * States, permanently and unmissably, where the figures on screen came from.
 *
 * The product must never let synthetic figures be read as government reporting,
 * so the demo notice is part of the application shell rather than a dismissible
 * toast, and it names the source in both modes.
 */
export function DataModeBanner({
  mode,
  label,
  lastSyncAt,
}: {
  mode: 'DEMO' | 'DHIS2';
  label: string;
  lastSyncAt: string | null;
}) {
  const synced = lastSyncAt
    ? new Date(lastSyncAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' })
    : 'never';

  // The badge always shows; the explanation is progressively revealed as space
  // allows. What must never be lost is that these figures are not real.
  if (mode === 'DHIS2') {
    return (
      <div className="flex min-w-0 items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
        <Badge tone="positive" icon={<span aria-hidden="true">●</span>}>
          Live DHIS2
        </Badge>
        <span className="hidden truncate lg:inline">
          {label} · synchronised {synced}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
      <Badge tone="warning" icon={<span aria-hidden="true">▲</span>}>
        Demo data
      </Badge>
      <span className="hidden whitespace-nowrap xl:inline">
        Synthetic figures for demonstration — not government reporting. Generated {synced}.
      </span>
      <span className="hidden whitespace-nowrap sm:inline xl:hidden">
        Synthetic figures — not government reporting
      </span>
    </div>
  );
}
