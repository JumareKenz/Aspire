/**
 * Product mark.
 *
 * No official HIVA logo, icon or wordmark was available in the repository, and
 * fabricating one would misrepresent a real organisation's identity. This is a
 * neutral geometric mark drawn from the brand token, and it is the single place
 * to swap in the official asset when it is supplied.
 */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="ASPIRE-GAC">
      <rect width="24" height="24" rx="6" fill="var(--brand-600)" />
      <path
        d="M7 16.5L12 7l5 9.5"
        fill="none"
        stroke="white"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.4 13.4h5.2" stroke="white" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
