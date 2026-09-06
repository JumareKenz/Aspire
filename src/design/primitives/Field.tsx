'use client';

import { useId, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes } from 'react';
import { cn } from './cn';

const CONTROL =
  'h-8 w-full rounded-[var(--radius-md)] border bg-[var(--surface)] px-2.5 text-[13px] text-[var(--text-primary)] transition-colors duration-150 hover:border-[var(--border-strong)]';

export function Select({
  label,
  hideLabel,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hideLabel?: boolean }) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={id}
        className={cn('text-[11px] font-medium text-[var(--text-tertiary)]', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <select id={id} className={cn(CONTROL, 'pr-7')} {...props}>
        {children}
      </select>
    </div>
  );
}

export function TextInput({
  label,
  hideLabel,
  className,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hideLabel?: boolean; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label
        htmlFor={id}
        className={cn('text-[11px] font-medium text-[var(--text-tertiary)]', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <input id={id} className={CONTROL} {...props} />
      {hint ? <p className="text-[11px] text-[var(--text-tertiary)]">{hint}</p> : null}
    </div>
  );
}
