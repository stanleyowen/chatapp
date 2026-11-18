import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function icon(paths: ReactNode) {
  return function Icon({ size = 18, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const LockIcon = icon(
  <>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>,
);
export const SendIcon = icon(
  <>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </>,
);
export const UsersIcon = icon(
  <>
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1" />
    <path d="M16 4.1a4 4 0 0 1 0 7.8" />
    <path d="M22 21v-1a6 6 0 0 0-4-5.6" />
  </>,
);
export const LinkIcon = icon(
  <>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </>,
);
export const ArrowLeftIcon = icon(
  <>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </>,
);
export const ArrowDownIcon = icon(
  <>
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </>,
);
export const CloseIcon = icon(
  <>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </>,
);
export const ShieldIcon = icon(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />);
export const VanishIcon = icon(
  <>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="m19 6-1 14H6L5 6" />
  </>,
);
export const EyeOffIcon = icon(
  <>
    <path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c7 0 10 8 10 8a17 17 0 0 1-3.2 4.2" />
    <path d="M6.6 6.6A17 17 0 0 0 2 12s3 8 10 8a10 10 0 0 0 5.4-1.6" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="m2 2 20 20" />
  </>,
);
export const ClockIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
);
export const AlertIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </>,
);
export const PlusIcon = icon(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
);
export const CopyIcon = icon(
  <>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>,
);

/** Quietroom mark: a speech bubble with a keyhole – the room only opens with its link. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill="var(--accent)" />
      <rect x="9" y="12" width="46" height="33" rx="10" fill="var(--accent-contrast)" />
      <path d="M13 37V53l12-9.5z" fill="var(--accent-contrast)" />
      <circle cx="32" cy="24.5" r="5" fill="var(--accent)" />
      <path d="M29.6 26 28 37.5h8L34.4 26z" fill="var(--accent)" />
    </svg>
  );
}
