/**
 * Shared icon set for the Next.js Unlocked deck.
 * Stroke-based, sized by CSS (.ic) like the original single-file deck.
 */
import React from "react";

const ICONS: Record<string, { d: string; fill?: boolean }> = {
  tri: { d: "M12 3 22 20H2Z", fill: true },
  "arrow-r": { d: "M4 12h16m-6-6 6 6-6 6" },
  check: { d: "m5 12 5 5L20 7" },
  x: { d: "M6 6l12 12M18 6 6 18" },
  "chev-l": { d: "m15 5-7 7 7 7" },
  "chev-r": { d: "m9 5 7 7-7 7" },
  globe: { d: "M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Z M2.5 12h19 M12 2.5a14.5 14.5 0 0 1 0 19 14.5 14.5 0 0 1 0-19Z" },
  file: { d: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6" },
  download: { d: "M12 3v12m-5-5 5 5 5-5M4 19h16" },
  cpu: { d: "M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3M19 9h3m-3 6h3" },
  server: { d: "M7 7h.01M7 17h.01" },
  monitor: { d: "M8 21h8m-4-4.5V21" },
  drop: { d: "M12 3a7 7 0 0 1 7 7c0 2-1 3.8-2.9 5.4-1.6 1.3-3.2 3.6-4.1 5.6-.9-2-2.5-4.3-4.1-5.6C6 13.8 5 12 5 10a7 7 0 0 1 7-7Z" },
  search: { d: "m21 21-4.5-4.5" },
  database: { d: "M3.5 5.5v13c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-13M3.5 12c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3" },
  layers: { d: "m2.5 12.5 9.5 5 9.5-5M2.5 17l9.5 5 9.5-5" },
  wrench: { d: "M14.5 6.5a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-8 7.9l-6.9 7a2.1 2.1 0 0 1-3-3l7-6.9a6 6 0 0 1 7.9-8l-3.8 3.8Z" },
  code: { d: "m15.5 18 6-6-6-6m-7 0-6 6 6 6" },
  swap: { d: "M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4" },
  plug: { d: "M9 7V2m6 5V2M7.5 7h9v5a4.5 4.5 0 0 1-9 0V7ZM12 16.5V22" },
  repeat: { d: "m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" },
  box: { d: "m3.3 7 8.7 5 8.7-5M12 22V12" },
  folder: { d: "M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5V6.5Z" },
  terminal: { d: "m4 17 6-5-6-5M12 19h8" },
  pointer: { d: "m3 3 7.1 17 2.5-7.4L20 10.1 3 3Z" },
  "circle-check": { d: "m8.5 12 2.5 2.5L16 9.5" },
  layout: { d: "M3 9h18M9 21V9" },
  copy: { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" },
  user: { d: "M4 21a8 8 0 0 1 16 0" },
  mail: { d: "m3 7 9 6 9-6" },
  link: { d: "M10 14a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 10a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" },
  at: { d: "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" },
  pin: { d: "M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11Z" },
  grad: { d: "M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M21.5 9v5" },
};

export function Ic({
  name,
  size,
  style,
}: {
  name: keyof typeof ICONS | string;
  size?: number;
  style?: React.CSSProperties;
}) {
  const icon = ICONS[name];
  if (!icon) return null;
  return (
    <svg
      className={icon.fill ? "ic ic-fill" : "ic"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={style}
      aria-hidden="true"
    >
      <path d={icon.d} />
    </svg>
  );
}
