/**
 * The ASPIRE-GAC mark.
 *
 * A rising column of four bars inside a rounded frame. The bars read as a
 * performance series moving upward — the platform's whole subject — while the
 * enclosing frame gives it the settled, institutional feel a government
 * programme needs. Geometry only: no illustration, no emoji, nothing
 * decorative, and it stays legible down to favicon size because the shapes are
 * thick and few.
 *
 * Colour comes from the brand tokens, so the mark follows the palette and both
 * themes rather than carrying its own hard-coded hexes.
 */
export function Logo({ size = 22, withWordmark = false }: { size?: number; withWordmark?: boolean }) {
  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="ASPIRE-GAC"
      className="shrink-0"
    >
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--brand-700)" />
      {/* Ascending series. The tallest bar is the accent: the point of the
          product is the direction of travel, not the individual values. */}
      <rect x="7.5" y="19" width="3.6" height="6" rx="1.3" fill="var(--brand-200)" />
      <rect x="12.8" y="15.4" width="3.6" height="9.6" rx="1.3" fill="var(--brand-200)" />
      <rect x="18.1" y="11.2" width="3.6" height="13.8" rx="1.3" fill="#ffffff" />
      <circle cx="23.6" cy="8.4" r="2.5" fill="var(--accent-400)" />
    </svg>
  );

  if (!withWordmark) return mark;

  return (
    <span className="flex items-center gap-2.5">
      {mark}
      <span className="leading-none">
        <span className="block text-[15px] font-semibold tracking-[-0.011em] text-[var(--text-primary)]">
          ASPIRE-GAC
        </span>
        <span className="mt-1 block text-[9px] tracking-[0.02em] text-[var(--text-tertiary)]">
          SRHR Intelligence &amp; Performance
        </span>
      </span>
    </span>
  );
}
