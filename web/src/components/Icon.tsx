const PATHS = {
  users: (
    <>
      <path d="M16 20v-1a4 4 0 00-4-4H8a4 4 0 00-4 4v1" />
      <circle cx="10" cy="8" r="3.4" />
      <path d="M20 20v-1a3.5 3.5 0 00-3-3.4M15.5 4.4a3.4 3.4 0 010 6.4" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 012-2h9" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
} as const;

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg
      className="ic"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
