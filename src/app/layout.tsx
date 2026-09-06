import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'ASPIRE-GAC SRHR Intelligence',
    template: '%s · ASPIRE-GAC',
  },
  description:
    'SRHR performance intelligence and decision support built on DHIS2 reporting: scorecards, data-quality intelligence, forecasting and evidence-grounded recommendations.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f5f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0f12' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
