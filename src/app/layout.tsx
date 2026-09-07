import type { Metadata, Viewport } from 'next';
import './globals.css';
import { THEME_INIT_SCRIPT } from '@/design/patterns/ThemeToggle';

export const metadata: Metadata = {
  title: {
    default: 'ASPIRE-GAC SRHR Intelligence',
    template: '%s · ASPIRE-GAC',
  },
  applicationName: 'ASPIRE-GAC SRHR Intelligence',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  description:
    'SRHR performance intelligence and decision support built on DHIS2 reporting: scorecards, data-quality intelligence, forecasting and evidence-grounded recommendations.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f5f2ec',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning` because the pre-paint script sets data-theme
    // on the html element before React hydrates.
    <html lang="en-GB" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
