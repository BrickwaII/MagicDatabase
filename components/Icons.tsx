/** Small inline icons, drawn with currentColor so they follow the theme. */
type P = { size?: number };

const base = (size = 22) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

/** The site mark: a round table with four seats, one of them the winner. */
export function PodMark({ size = 26 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="podmark">
      <circle cx="16" cy="16" r="9" fill="var(--accent)" />
      <circle cx="16" cy="3.5" r="3" fill="var(--win)" />
      <circle cx="28.5" cy="16" r="3" fill="var(--text)" opacity="0.8" />
      <circle cx="16" cy="28.5" r="3" fill="var(--text)" opacity="0.8" />
      <circle cx="3.5" cy="16" r="3" fill="var(--text)" opacity="0.8" />
    </svg>
  );
}

export function HomeIcon({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export function GamesIcon({ size }: P) {
  return (
    <svg {...base(size)}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M8 9h8M8 12.5h8M8 16h5" />
    </svg>
  );
}

export function PlusIcon({ size }: P) {
  return (
    <svg {...base(size)} strokeWidth={2.4}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function StatsIcon({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M5 20V11M12 20V5M19 20v-6" />
    </svg>
  );
}

export function DecksIcon({ size }: P) {
  return (
    <svg {...base(size)}>
      <rect x="7" y="3.5" width="12" height="16" rx="2" />
      <path d="M5 7v12.5A1.5 1.5 0 0 0 6.5 21H15" />
    </svg>
  );
}

export function QueueIcon({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M5 12.5 9.5 17 19 7" />
    </svg>
  );
}

export function GearIcon({ size }: P) {
  return (
    <svg {...base(size)}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </svg>
  );
}

export function UpIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)} strokeWidth={2.2}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

export function DownIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)} strokeWidth={2.2}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  );
}

export function CloseIcon({ size = 18 }: P) {
  return (
    <svg {...base(size)} strokeWidth={2.2}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function CrownIcon({ size = 16 }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="crown">
      <path fill="currentColor" d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z" />
    </svg>
  );
}
