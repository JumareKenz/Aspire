import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * A quiet table.
 *
 * Comparison is what tables are for, so rows are dense, figures are tabular,
 * and rules are kept to the minimum needed to track across a row. Wide tables
 * scroll inside their own container so the page itself never scrolls sideways.
 */
export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('-mx-1 overflow-x-auto px-1', className)}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  className,
  scope = 'col',
  width,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  scope?: 'col' | 'row';
  width?: string;
}) {
  return (
    <th
      scope={scope}
      style={width ? { width } : undefined}
      className={cn(
        'border-b px-3 py-2 text-[11px] font-medium tracking-wide text-[var(--text-tertiary)]',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
  numeric,
  colSpan,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  numeric?: boolean;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'border-b border-[var(--border)]/60 px-3 py-2 align-middle text-[var(--text-primary)]',
        numeric && 'numeric',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  className,
  interactive,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <tr
      className={cn(
        interactive && 'cursor-pointer transition-colors duration-100 hover:bg-[var(--ink-050)]',
        className,
      )}
    >
      {children}
    </tr>
  );
}
