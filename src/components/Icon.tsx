import type { SVGProps } from "react";

type IconName =
  | "book"
  | "play"
  | "headphones"
  | "eye"
  | "chart"
  | "clock"
  | "check"
  | "arrow"
  | "download"
  | "upload"
  | "info"
  | "spark"
  | "volume"
  | "history"
  | "target"
  | "close";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

const paths: Record<IconName, React.ReactNode> = {
  book: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H20v16H7.5A3.5 3.5 0 0 0 4 21.5z"/><path d="M4 5.5v16"/></>,
  play: <path d="m8 5 11 7-11 7z" />,
  headphones: <><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M18 19h1a1 1 0 0 0 1-1v-4h-3v4a1 1 0 0 0 1 1ZM6 19H5a1 1 0 0 1-1-1v-4h3v4a1 1 0 0 1-1 1Z"/></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
  chart: <><path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19H2"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  check: <path d="m5 12 4 4L19 6" />,
  arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
  download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
  upload: <><path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7h.01"/></>,
  spark: <><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"/><path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6z"/></>,
  volume: <><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M18 6a8 8 0 0 1 0 12"/></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></>,
  target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  close: <><path d="m6 6 12 12"/><path d="m18 6-12 12"/></>,
};

export function Icon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
