import type { ReactNode } from 'react';
import { cn } from './cn';

export type Tone = 'neutral' | 'brand' | 'positive' | 'warning' | 'concern' | 'info';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-[var(--ink-100)] text-[var(--text-secondary)] border-transparent',
  brand: 'bg-[var(--brand-100)] text-[var(--brand-700)] border-transparent',
  positive: 'bg-[var(--positive-100)] text-[var(--positive-700)] border-transparent',
  warning: 'bg-[var(--warning-100)] text-[var(--warning-700)] border-transparent',
  concern: 'bg-[var(--concern-100)] text-[var(--concern-700)] border-transparent',
  info: 'bg-[var(--info-100)] text-[var(--info-700)] border-transparent',
};

export function Badge({
  children,
  tone = 'neutral',
  icon,
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
