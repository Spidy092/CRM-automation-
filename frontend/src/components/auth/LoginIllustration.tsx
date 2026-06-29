interface LoginIllustrationProps {
  className?: string;
}

export function LoginIllustration({ className }: LoginIllustrationProps) {
  return (
    <svg
      viewBox="0 0 480 280"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      role="img"
    >
      {/* Outer card frame */}
      <rect x="20" y="20" width="440" height="240" rx="12" />
      {/* Header bar */}
      <line x1="20" y1="56" x2="460" y2="56" />
      <circle cx="40" cy="38" r="3" />
      <circle cx="54" cy="38" r="3" />
      <circle cx="68" cy="38" r="3" />

      {/* Pipeline bars (3 stacked) */}
      <rect x="40" y="80" width="180" height="14" rx="4" />
      <rect x="40" y="104" width="140" height="14" rx="4" />
      <rect x="40" y="128" width="200" height="14" rx="4" />

      {/* Stat cards (3 right column) */}
      <rect x="260" y="80" width="80" height="40" rx="6" />
      <rect x="350" y="80" width="80" height="40" rx="6" />
      <rect x="260" y="130" width="170" height="40" rx="6" />

      {/* Mini line chart in stat card 3 */}
      <polyline points="270,160 290,150 310,156 330,144 350,148 370,138 390,142 410,132" />

      {/* Bottom section — message list */}
      <line x1="40" y1="180" x2="440" y2="180" />
      <circle cx="50" cy="200" r="6" />
      <line x1="64" y1="196" x2="200" y2="196" />
      <line x1="64" y1="206" x2="160" y2="206" />

      <circle cx="50" cy="232" r="6" />
      <line x1="64" y1="228" x2="220" y2="228" />
      <line x1="64" y1="238" x2="180" y2="238" />
    </svg>
  );
}
