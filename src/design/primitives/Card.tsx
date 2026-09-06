import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * A card groups information that belongs together. It is not the default
 * container: most figures read better in plain sections with whitespace and
 * typography doing the work, and a page of cards reads as a template.
 */
export function Card({
  children,
  className,
  as: Component = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return (
    <Component
      className={cn(
        'rounded-[var(--radius-lg)] border bg-[var(--surface)] shadow-[var(--shadow-sm)]',
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-4 pb-3', className)}>
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-[-0.006em] text-[var(--text-primary)]">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-tertiary)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-5 pb-5', className)}>{children}</div>;
}

export function CardDivider() {
  return <div className="h-px w-full bg-[var(--border)]" role="presentation" />;
}
