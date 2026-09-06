import type { ReactNode } from 'react';
import { requireUser } from '@/auth/server';
import { can } from '@/auth/rbac';
import { AppShell, type NavItem } from '@/design/patterns/AppShell';
import {
  ActionsIcon,
  AdminIcon,
  IntelligenceIcon,
  MapIcon,
  OverviewIcon,
  PerformanceIcon,
  ReportsIcon,
} from '@/design/patterns/icons';
import { getDataMode, getLastSyncAt } from '@/data/repositories/settings';
import { getSourceAdapter } from '@/data/sources';

/**
 * Every page in this group requires a session. Navigation is assembled from
 * the user's permissions rather than being filtered in the client, so a link a
 * user cannot follow is never rendered in the first place.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  const navigation: NavItem[] = [
    { href: '/overview', label: 'Overview', icon: <OverviewIcon /> },
    { href: '/performance', label: 'Performance', icon: <PerformanceIcon /> },
    { href: '/intelligence', label: 'Intelligence', icon: <IntelligenceIcon /> },
    { href: '/map', label: 'Map', icon: <MapIcon /> },
    { href: '/reports', label: 'Reports', icon: <ReportsIcon /> },
    { href: '/actions', label: 'Actions', icon: <ActionsIcon /> },
  ];

  const adminNavigation: NavItem[] = can(user.role, 'admin.view')
    ? [{ href: '/admin', label: 'Admin', icon: <AdminIcon /> }]
    : [];

  const adapter = getSourceAdapter();
  const [mode, lastSyncAt] = await Promise.all([getDataMode(), getLastSyncAt()]);

  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role }}
      navigation={navigation}
      adminNavigation={adminNavigation}
      dataMode={{ mode, label: adapter.label, lastSyncAt }}
    >
      {children}
    </AppShell>
  );
}
