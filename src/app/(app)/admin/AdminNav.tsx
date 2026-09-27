'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/design/primitives/cn';

const TABS = [
  { href: '/admin', label: 'System' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/indicators', label: 'Indicators' },
  { href: '/admin/validation', label: 'Data validation' },
  { href: '/admin/explorer', label: 'Data explorer' },
  { href: '/admin/audit', label: 'Audit' },
];

/**
 * Administration is kept separate from the intelligence experience, so it has
 * its own local navigation rather than adding entries to the main sidebar.
 */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Administration"
      className="-mx-4 mb-7 flex items-center gap-1 overflow-x-auto border-b px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors',
              active
                ? 'border-[var(--brand-600)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
