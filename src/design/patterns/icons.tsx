/**
 * Navigation icons.
 *
 * Drawn inline at a single weight so the sidebar reads as one set. They are
 * decorative — every item is labelled in text — so they are hidden from
 * assistive technology.
 */
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const OverviewIcon = () => (
  <svg {...base}>
    <rect x="2" y="2" width="5" height="6" rx="1.2" />
    <rect x="9" y="2" width="5" height="4" rx="1.2" />
    <rect x="2" y="10" width="5" height="4" rx="1.2" />
    <rect x="9" y="8" width="5" height="6" rx="1.2" />
  </svg>
);

export const PerformanceIcon = () => (
  <svg {...base}>
    <path d="M2 13V3" />
    <path d="M2 13h12" />
    <path d="M4.5 10.5l3-3.5 2.5 2 3.5-4.5" />
  </svg>
);

export const IntelligenceIcon = () => (
  <svg {...base}>
    <path d="M8 1.8c2.5 0 4.2 1.7 4.2 3.9 0 1.5-.8 2.4-1.5 3.2-.5.6-.8 1-.8 1.7H6.1c0-.7-.3-1.1-.8-1.7-.7-.8-1.5-1.7-1.5-3.2 0-2.2 1.7-3.9 4.2-3.9Z" />
    <path d="M6.3 12.6h3.4" />
    <path d="M6.9 14.3h2.2" />
  </svg>
);

export const MapIcon = () => (
  <svg {...base}>
    <path d="M6 2.6 2.4 4v9.4L6 12l4 1.4 3.6-1.4V2.6L10 4 6 2.6Z" />
    <path d="M6 2.6V12" />
    <path d="M10 4v9.4" />
  </svg>
);

export const ReportsIcon = () => (
  <svg {...base}>
    <path d="M4 1.8h5.2L12.5 5v9.2H4z" />
    <path d="M9 2v3.2h3.3" />
    <path d="M6 9h4M6 11.4h2.6" />
  </svg>
);

export const ActionsIcon = () => (
  <svg {...base}>
    <path d="M3.2 4.6h9.6M3.2 8h9.6M3.2 11.4h5.6" />
    <circle cx="12.2" cy="11.4" r="1.6" />
  </svg>
);

export const AdminIcon = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.9v1.6M8 12.5v1.6M14.1 8h-1.6M3.5 8H1.9M12.3 3.7l-1.1 1.1M4.8 11.2l-1.1 1.1M12.3 12.3l-1.1-1.1M4.8 4.8 3.7 3.7" />
  </svg>
);
