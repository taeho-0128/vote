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
  eraser: (
    <>
      <path d="M8 20h11" />
      <path d="M5.2 15.2L14 6.4a2 2 0 012.8 0l2.8 2.8a2 2 0 010 2.8L11.6 20H8l-2.8-2.8a2 2 0 010-2z" />
    </>
  ),
  undo: (
    <>
      <path d="M9 7L4 12l5 5" />
      <path d="M4 12h10a5 5 0 010 9h-3" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14" />
      <path d="M10 7V4h4v3" />
      <path d="M7 7l1 13h8l1-13" />
    </>
  ),
  left: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  shrink: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  down: <path d="M6 9l6 6 6-6" />,
  download: (
    <>
      <path d="M12 4v11M7.5 11L12 15.5 16.5 11" />
      <path d="M5 19.5h14" />
    </>
  ),
  print: (
    <>
      <path d="M7 9V4h10v5" />
      <path d="M7 17H5.5A1.5 1.5 0 014 15.5V11a2 2 0 012-2h12a2 2 0 012 2v4.5a1.5 1.5 0 01-1.5 1.5H17" />
      <path d="M7 14h10v6H7z" />
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

export function Icon({ name, size = 18, weight = 1.9 }: { name: keyof typeof PATHS; size?: number; weight?: number }) {
  return (
    <svg
      className="ic"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
