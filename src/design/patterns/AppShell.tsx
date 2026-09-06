'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { cn } from '../primitives/cn';
import { Logo } from './Logo';
import { DataModeBanner } from '../primitives/DataModeBanner';
import type { Role } from '@/data/repositories/users';
import { ROLE_LABELS } from '@/auth/rbac';

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

/**
 * The application shell.
 *
 * Navigation is deliberately short. Every extra destination is a decision the
 * user has to make before they can start work, so related capabilities live
 * inside a workspace rather than becoming their own sidebar entry.
 */
export function AppShell({
  user,
  navigation,
  adminNavigation,
  dataMode,
  children,
}: {
  user: { name: string; email: string; role: Role };
  navigation: NavItem[];
  adminNavigation: NavItem[];
  dataMode: { mode: 'DEMO' | 'DHIS2'; label: string; lastSyncAt: string | null };
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const renderNav = (items: NavItem[]) =>
    items.map((item) => (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        aria-current={isActive(item.href) ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[13px] transition-colors duration-150',
          isActive(item.href)
            ? 'bg-[var(--brand-100)] font-medium text-[var(--brand-700)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--ink-100)] hover:text-[var(--text-primary)]',
        )}
      >
        <span className="shrink-0 opacity-80" aria-hidden="true">
          {item.icon}
        </span>
        {item.label}
      </Link>
    ));

  return (
    <div className="min-h-dvh bg-[var(--canvas)]">
      <header className="sticky top-0 z-30 flex h-[var(--header-height)] items-center gap-3 border-b bg-[var(--surface)]/85 px-3 backdrop-blur-md sm:px-4">
        <button
          type="button"
          className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--ink-100)] lg:hidden"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-label="Toggle navigation"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <Link href="/overview" className="flex shrink-0 items-center gap-2.5">
          <Logo />
          <span className="hidden text-[13px] font-semibold whitespace-nowrap tracking-[-0.011em] sm:block">
            ASPIRE-GAC
            {/* The descriptor is the first thing to go: the mark and the name
                identify the product on their own once space is tight. */}
            <span className="ml-1.5 hidden font-normal text-[var(--text-tertiary)] xl:inline">
              SRHR Intelligence
            </span>
          </span>
        </Link>

        <div className="ml-auto flex min-w-0 items-center gap-4">
          <DataModeBanner {...dataMode} />
          <div className="hidden items-center gap-2 border-l pl-4 lg:flex">
            <div className="text-right leading-tight">
              <p className="text-[12px] font-medium whitespace-nowrap">{user.name}</p>
              <p className="text-[11px] whitespace-nowrap text-[var(--text-tertiary)]">
                {ROLE_LABELS[user.role]}
              </p>
            </div>
          </div>
          <form action="/api/auth/sign-out" method="post" className="shrink-0">
            <button
              type="submit"
              className="rounded-[var(--radius-md)] px-2 py-1 text-[12px] whitespace-nowrap text-[var(--text-tertiary)] transition-colors hover:bg-[var(--ink-100)] hover:text-[var(--text-primary)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="flex">
        {/* The rail carries the surface colour for the full height of the page,
            so a page taller than the viewport does not show a seam where the
            sticky navigation ends. */}
        <div className="hidden w-[var(--sidebar-width)] shrink-0 border-r bg-[var(--surface)] lg:block">
          <nav
            aria-label="Primary"
            className="sticky top-[var(--header-height)] px-2.5 py-3"
            style={{ height: 'calc(100dvh - var(--header-height))' }}
          >
            <div className="flex h-full flex-col">
              <div className="space-y-0.5">{renderNav(navigation)}</div>
              {adminNavigation.length > 0 ? (
                <div className="mt-auto space-y-0.5 border-t pt-3">{renderNav(adminNavigation)}</div>
              ) : null}
            </div>
          </nav>
        </div>

        <nav
          aria-label="Primary"
          className={cn(
            'fixed inset-y-0 top-[var(--header-height)] z-20 w-[var(--sidebar-width)] border-r bg-[var(--surface)] px-2.5 py-3 transition-transform duration-200 lg:hidden',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          style={{ height: 'calc(100dvh - var(--header-height))' }}
        >
          <div className="flex h-full flex-col">
            <div className="space-y-0.5">{renderNav(navigation)}</div>
            {adminNavigation.length > 0 ? (
              <div className="mt-auto space-y-0.5 border-t pt-3">{renderNav(adminNavigation)}</div>
            ) : null}
          </div>
        </nav>

        {mobileOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-10 bg-black/20 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        ) : null}

        <main id="main" className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
