/**
 * Hand-drawn 16px icon set on a shared 16-unit grid with a 1.4 stroke, so the
 * whole interface has one drawing hand. No icon-font dependency, no 400 kB
 * package for the twenty marks this app actually uses.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconDrive = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 5.2l6-3 6 3v5.6l-6 3-6-3z" />
    <path d="M8 2.2v11.6M2 5.2l6 3 6-3" opacity="0.5" />
  </Icon>
);

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.6V8l2.4 1.6" />
  </Icon>
);

export const IconStar = ({ filled, ...p }: IconProps & { filled?: boolean }) => (
  <Icon {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="M8 2.2l1.76 3.7 4 .55-2.9 2.83.71 4.02L8 11.4l-3.57 1.9.71-4.02-2.9-2.83 4-.55z" />
  </Icon>
);

export const IconShare = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="3.6" r="1.8" />
    <circle cx="4" cy="8" r="1.8" />
    <circle cx="12" cy="12.4" r="1.8" />
    <path d="M10.4 4.5L5.6 7.1M5.6 8.9l4.8 2.6" />
  </Icon>
);

export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.8 4.4h10.4M6 4.4V3.1c0-.4.3-.7.7-.7h2.6c.4 0 .7.3.7.7v1.3" />
    <path d="M4.1 4.4l.6 8.3c0 .5.4.9.9.9h4.8c.5 0 .9-.4.9-.9l.6-8.3" />
    <path d="M6.6 7v4M9.4 7v4" opacity="0.5" />
  </Icon>
);

export const IconFolder = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.8 4.4c0-.6.5-1.1 1.1-1.1h2.9l1.3 1.6h5c.6 0 1.1.5 1.1 1.1v5.6c0 .6-.5 1.1-1.1 1.1H2.9c-.6 0-1.1-.5-1.1-1.1z" />
  </Icon>
);

export const IconFolderOpen = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.8 4.4c0-.6.5-1.1 1.1-1.1h2.9l1.3 1.6h5c.6 0 1.1.5 1.1 1.1v1.2" />
    <path d="M1.8 7.2h12.6l-1.5 5.3c-.1.4-.5.7-.9.7H3.1c-.5 0-.9-.3-1-.8z" />
  </Icon>
);

export const IconUpload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 11V2.8M4.9 5.9L8 2.8l3.1 3.1" />
    <path d="M2.6 10v2.4c0 .5.4.9.9.9h9c.5 0 .9-.4.9-.9V10" />
  </Icon>
);

export const IconDownload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.6v8.2M4.9 7.7L8 10.8l3.1-3.1" />
    <path d="M2.6 10.6v1.8c0 .5.4.9.9.9h9c.5 0 .9-.4.9-.9v-1.8" />
  </Icon>
);

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.4" />
    <path d="M10.3 10.3l3.1 3.1" />
  </Icon>
);

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 8.4l3.2 3.2L13 4.8" />
  </Icon>
);

export const IconChevron = ({ dir = 'right', ...p }: IconProps & { dir?: 'up' | 'down' | 'left' | 'right' }) => {
  const rotate = { right: 0, down: 90, left: 180, up: 270 }[dir];
  return (
    <Icon {...p} style={{ transform: `rotate(${rotate}deg)`, ...p.style }}>
      <path d="M6.2 3.6L10.6 8l-4.4 4.4" />
    </Icon>
  );
};

export const IconMore = (p: IconProps) => (
  <Icon {...p} strokeWidth="0">
    <circle cx="3.4" cy="8" r="1.3" fill="currentColor" />
    <circle cx="8" cy="8" r="1.3" fill="currentColor" />
    <circle cx="12.6" cy="8" r="1.3" fill="currentColor" />
  </Icon>
);

export const IconLink = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.6 9.4l2.8-2.8" />
    <path d="M9 4.2l.9-.9a2.4 2.4 0 013.4 3.4l-.9.9M7 11.8l-.9.9a2.4 2.4 0 01-3.4-3.4l.9-.9" />
  </Icon>
);

export const IconLock = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.4" y="7" width="9.2" height="6.4" rx="1.1" />
    <path d="M5.6 7V5.3a2.4 2.4 0 014.8 0V7" />
  </Icon>
);

export const IconGlobe = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="5.8" />
    <path d="M2.4 8h11.2M8 2.2c1.5 1.6 2.3 3.6 2.3 5.8s-.8 4.2-2.3 5.8C6.5 12.2 5.7 10.2 5.7 8S6.5 3.8 8 2.2z" opacity="0.6" />
  </Icon>
);

export const IconEye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.6 8s2.4-4.2 6.4-4.2S14.4 8 14.4 8s-2.4 4.2-6.4 4.2S1.6 8 1.6 8z" />
    <circle cx="8" cy="8" r="1.9" />
  </Icon>
);

export const IconGrid = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.4" y="2.4" width="4.6" height="4.6" rx="1" />
    <rect x="9" y="2.4" width="4.6" height="4.6" rx="1" />
    <rect x="2.4" y="9" width="4.6" height="4.6" rx="1" />
    <rect x="9" y="9" width="4.6" height="4.6" rx="1" />
  </Icon>
);

export const IconList = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.6 4h10.8M2.6 8h10.8M2.6 12h10.8" />
  </Icon>
);

export const IconPencil = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.6 2.9l2.5 2.5-7.6 7.6-3.1.6.6-3.1z" />
    <path d="M9.2 4.3l2.5 2.5" opacity="0.5" />
  </Icon>
);

export const IconMove = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.6v10.8M2.6 8h10.8" opacity="0.35" />
    <path d="M8 2.6L6.3 4.3M8 2.6l1.7 1.7M8 13.4l-1.7-1.7M8 13.4l1.7-1.7M2.6 8l1.7-1.7M2.6 8l1.7 1.7M13.4 8l-1.7-1.7M13.4 8l-1.7 1.7" />
  </Icon>
);

export const IconRestore = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.6 8a5.4 5.4 0 105.4-5.4A5.4 5.4 0 003.4 5.3" />
    <path d="M2.4 2.6v3h3" />
  </Icon>
);

export const IconShield = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 1.8l5 1.9v4.1c0 3-2.1 5.4-5 6.4-2.9-1-5-3.4-5-6.4V3.7z" />
    <path d="M5.8 7.9l1.6 1.6 3-3.1" />
  </Icon>
);

export const IconActivity = (p: IconProps) => (
  <Icon {...p}>
    <path d="M1.8 8.4h2.6l1.7-4.6 2.4 8 1.8-5.1 1.1 1.7h2.8" />
  </Icon>
);

export const IconSettings = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.8v1.7M8 12.5v1.7M2.9 4.9l1.5.9M11.6 10.2l1.5.9M2.9 11.1l1.5-.9M11.6 5.8l1.5-.9" />
  </Icon>
);

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 3.2v9.6M3.2 8h9.6" />
  </Icon>
);

export const IconSort = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.4 3.4v9.2M2.2 10.4l2.2 2.2 2.2-2.2" />
    <path d="M9 4.6h4.8M9 8h3.4M9 11.4h2" opacity="0.6" />
  </Icon>
);

export const IconFilter = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.4 4h11.2l-4.3 5v4.4L6.7 12V9z" />
  </Icon>
);

export const IconWarn = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 2.4l6 10.4H2z" />
    <path d="M8 6.3v3.1M8 11.2v.1" />
  </Icon>
);

export const IconSpinner = ({ size = 16, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden {...p}>
    <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.2" />
    <path
      d="M8 2a6 6 0 016 6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      style={{ transformOrigin: '8px 8px', animation: 'spin 700ms linear infinite' }}
    />
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </svg>
);
