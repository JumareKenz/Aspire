/**
 * The HIVA mark.
 *
 * Redrawn as SVG from the supplied HIVA logo artwork (`HIVA_Logo.png`): a
 * forest-green ring with two gold orbital arcs, and an "H" whose crossbar is a
 * gold node. Vector rather than the raster original so it stays sharp at
 * favicon size and inherits the brand tokens.
 *
 * Brand colours are read from `--brand-*` and `--accent-*` so the mark cannot
 * drift from the rest of the palette.
 */
export function Logo({ size = 22, withWordmark = false }: { size?: number; withWordmark?: boolean }) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="HIVA"
      className="shrink-0"
    >
      {/* Ring, broken at the foot as in the original artwork. */}
      <path
        d="M24 4.5a19.5 19.5 0 0 1 13.9 33.2M24 4.5A19.5 19.5 0 0 0 10.1 37.7"
        stroke="var(--brand-600)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M14.6 41.3A19.4 19.4 0 0 0 20.4 43.3M33.4 41.3a19.4 19.4 0 0 1-5.8 2"
        stroke="var(--brand-600)"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* Gold orbital arcs with their terminal nodes. */}
      <path
        d="M31.6 8.4a17.5 17.5 0 0 1 6.6 8.6"
        stroke="var(--accent-500)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="30.4" cy="7.9" r="2.1" fill="var(--accent-500)" />
      <path
        d="M16.4 39.6a17.5 17.5 0 0 1-6.6-8.6"
        stroke="var(--accent-500)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="17.6" cy="40.1" r="2.1" fill="var(--accent-500)" />

      {/* The H, with a gold node for its crossbar. */}
      <path
        d="M18 13v9.4M18 25.6V35M30 13v9.4M30 25.6V35"
        stroke="var(--brand-600)"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path d="M19.8 24h2.6M25.6 24h2.6" stroke="var(--brand-600)" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="24" cy="24" r="3.1" fill="var(--accent-500)" />
    </svg>
  );

  if (!withWordmark) return mark;

  return (
    <span className="flex items-center gap-2.5">
      {mark}
      <span className="leading-none">
        <span className="block text-[15px] font-semibold tracking-[0.14em] text-[var(--brand-700)]">
          HIVA
        </span>
        <span className="mt-1 block text-[8px] tracking-[0.1em] text-[var(--text-tertiary)]">
          Intelligence. Connected. Trusted.
        </span>
      </span>
    </span>
  );
}
