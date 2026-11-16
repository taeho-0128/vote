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
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  pen: (
    <>
      <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
  eyeoff: (
    <>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M4 4l16 16" />
    </>
  ),
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
