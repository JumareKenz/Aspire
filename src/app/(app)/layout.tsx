import type { ReactNode } from 'react';
import { currentExperience } from '@/auth/server';
import { NAV_LABELS, NAV_ROUTES, type NavKey } from '@/auth/experience';
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

const NAV_ICONS: Record<NavKey, ReactNode> = {
  overview: <OverviewIcon />,
  performance: <PerformanceIcon />,
  intelligence: <IntelligenceIcon />,
  map: <MapIcon />,
  reports: <ReportsIcon />,
  actions: <ActionsIcon />,
  admin: <AdminIcon />,
};

/**
 * Every page in this group requires a session.
 *
 * Navigation is generated from the user's resolved experience rather than a
 * fixed list, and each destination is route-guarded against the same list — so
 * a link that is not rendered is also not reachable by typing its URL.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, experience } = await currentExperience();

  const toItem = (key: NavKey): NavItem => ({
    href: NAV_ROUTES[key],
    label: NAV_LABELS[key],
    icon: NAV_ICONS[key],
  });

  // Administration stays visually separate from the intelligence experience.
  const navigation = experience.navigation.filter((key) => key !== 'admin').map(toItem);
  const adminNavigation = experience.navigation.filter((key) => key === 'admin').map(toItem);

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
