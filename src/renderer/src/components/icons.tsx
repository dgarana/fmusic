import type { SVGProps } from 'react';

/**
 * Inline SVG icon set used across the renderer.
 *
 * All icons:
 *  - use `currentColor` so they inherit from the parent (button color etc.).
 *  - default to 18px, but accept any `size` prop.
 *  - forward every other SVG prop (className, style, onClick, ...).
 *
 * Shapes are drawn against a 24x24 viewBox for consistency.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number | string;
}

function Base({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 5.5v13a.7.7 0 0 0 1.06.6l10.8-6.5a.7.7 0 0 0 0-1.2L8.06 4.9A.7.7 0 0 0 7 5.5Z" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function PrevIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="5" y="5" width="2" height="14" rx="1" fill="currentColor" stroke="none" />
      <path d="M19 5.8v12.4a.7.7 0 0 1-1.07.6L8.5 13a.7.7 0 0 1 0-1.2l9.43-5.8a.7.7 0 0 1 1.07.6Z" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function NextIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 5.8v12.4a.7.7 0 0 0 1.07.6L15.5 13a.7.7 0 0 0 0-1.2L6.07 6a.7.7 0 0 0-1.07.6Z" fill="currentColor" stroke="none" />
      <rect x="17" y="5" width="2" height="14" rx="1" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 20.5s-7.5-4.5-9.3-9.1a5 5 0 0 1 8.2-5.4l1.1 1.1 1.1-1.1a5 5 0 0 1 8.2 5.4C19.5 16 12 20.5 12 20.5Z" />
    </Base>
  );
}

export function HeartFilledIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 20.5s-7.5-4.5-9.3-9.1a5 5 0 0 1 8.2-5.4l1.1 1.1 1.1-1.1a5 5 0 0 1 8.2 5.4C19.5 16 12 20.5 12 20.5Z" fill="currentColor" stroke="currentColor" />
    </Base>
  );
}

export function VolumeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 10v4a1 1 0 0 0 1 1h3l4.3 3.5a.7.7 0 0 0 1.2-.5V6a.7.7 0 0 0-1.2-.5L8 9H5a1 1 0 0 0-1 1Z" fill="currentColor" stroke="none" />
      <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" />
    </Base>
  );
}

export function VolumeMuteIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 10v4a1 1 0 0 0 1 1h3l4.3 3.5a.7.7 0 0 0 1.2-.5V6a.7.7 0 0 0-1.2-.5L8 9H5a1 1 0 0 0-1 1Z" fill="currentColor" stroke="none" />
      <path d="M16.5 9.5 21 14M21 9.5 16.5 14" />
    </Base>
  );
}

export function CastIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" />
      <path d="M4 12a8 8 0 0 1 8 8M4 16a4 4 0 0 1 4 4M5 20h.01" />
    </Base>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </Base>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.5-3.5" />
    </Base>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
      <path d="m14 6 4 4" />
    </Base>
  );
}

export function ScissorsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.5 15.5M14.5 14.5 20 20M8.5 8.5l3 3" />
    </Base>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4" />
      <path d="M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4" />
    </Base>
  );
}

export function QrCodeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Base>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m6 15 6-6 6 6" />
    </Base>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m6 9 6 6 6-6" />
    </Base>
  );
}

export function ExpandIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M15 4h5v5M20 4l-6 6M9 20H4v-5M4 20l6-6" />
    </Base>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M15 3 21 9M17.5 8 11 14.5l-3.5-.2L5 17l2 2 2.7-2.5.2 3.5L16 13.5" />
    </Base>
  );
}

export function MusicIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" fill="currentColor" stroke="currentColor" />
      <circle cx="17" cy="16" r="3" fill="currentColor" stroke="currentColor" />
    </Base>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M6.5 17.5 9 15M15 9l2.5-2.5" />
    </Base>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </Base>
  );
}

export function LibraryIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 4h3v16H4zM10 4h3v16h-3zM17 5l3 1-4 14-3-1z" />
    </Base>
  );
}

export function PlaylistIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6h12M4 12h12M4 18h8" />
      <circle cx="18" cy="17" r="2.5" fill="currentColor" stroke="currentColor" />
      <path d="M20.5 17V9l-3 1" />
    </Base>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </Base>
  );
}
