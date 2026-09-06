import type { PerformanceStatus } from '@/core/scoring/types';
import type { Severity } from '@/core/quality/types';
import { Badge, type Tone } from './Badge';

/**
 * Status is never communicated by colour alone: every pill carries a shape and
 * a written label, so it survives greyscale printing, colour-vision deficiency
 * and forced-colours mode.
 */
const STATUS_META: Record<PerformanceStatus, { label: string; tone: Tone; glyph: string }> = {
  ON_TRACK: { label: 'On track', tone: 'positive', glyph: '●' },
  WATCH: { label: 'Watch', tone: 'warning', glyph: '◐' },
  NEEDS_ATTENTION: { label: 'Needs attention', tone: 'concern', glyph: '▲' },
  NO_DATA: { label: 'No data', tone: 'neutral', glyph: '—' },
};

export function StatusPill({ status, compact }: { status: PerformanceStatus; compact?: boolean }) {
  const meta = STATUS_META[status];
  return (
    <Badge tone={meta.tone} icon={<span aria-hidden="true">{meta.glyph}</span>}>
      {compact ? meta.label.split(' ')[0] : meta.label}
    </Badge>
  );
}

const SEVERITY_META: Record<Severity, { label: string; tone: Tone; glyph: string }> = {
  HIGH: { label: 'High', tone: 'concern', glyph: '▲' },
  MEDIUM: { label: 'Medium', tone: 'warning', glyph: '◆' },
  LOW: { label: 'Low', tone: 'neutral', glyph: '▪' },
};

export function SeverityPill({ severity }: { severity: Severity }) {
  const meta = SEVERITY_META[severity];
  return (
    <Badge tone={meta.tone} icon={<span aria-hidden="true">{meta.glyph}</span>}>
      {meta.label}
    </Badge>
  );
}
