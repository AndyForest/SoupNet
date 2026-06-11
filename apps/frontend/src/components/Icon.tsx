/**
 * Minimal SVG icon set for navigation.
 * Each icon is 20x20, stroke-based, 1.5px stroke width.
 * Icons with multiple paths use string arrays.
 */

interface IconProps {
  name: "home" | "search" | "key" | "users" | "settings" | "chevron-right" | "copy" | "plus" | "x" | "clock" | "arrow-left" | "clipboard-check" | "external-link" | "upload" | "download" | "map" | "book-open" | "mail";
  size?: number;
  className?: string;
}

const paths: Record<IconProps["name"], string | string[]> = {
  home: "M3 9.5L10 3l7 6.5V17a1 1 0 0 1-1 1h-4v-4H8v4H4a1 1 0 0 1-1-1V9.5z",
  search: "M9 3a6 6 0 1 0 0 12A6 6 0 0 0 9 3zM17 17l-3.5-3.5",
  key: "M15.5 3a4.5 4.5 0 0 0-4.27 5.88L3 17.12V20h2.88l.53-.53v-1.59h1.59l.53-.53v-1.59h1.59l1.12-1.12A4.5 4.5 0 1 0 15.5 3zm1 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2z",
  users: "M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm6-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM2 17v-1c0-2 2-3.5 5-3.5s5 1.5 5 3.5v1zm9-4.5c2 0 4 1 4 3v1.5",
  settings: [
    // Outer gear teeth (centered on 10,10)
    "M10 2.5l1.2 2.1a5.5 5.5 0 0 1 2.2 1.3l2.3-.6 1 1.7-1.1 2a5.5 5.5 0 0 1 0 2.6l1.1 2-1 1.7-2.3-.6a5.5 5.5 0 0 1-2.2 1.3L10 17.5l-1.2-2.1a5.5 5.5 0 0 1-2.2-1.3l-2.3.6-1-1.7 1.1-2a5.5 5.5 0 0 1 0-2.6l-1.1-2 1-1.7 2.3.6a5.5 5.5 0 0 1 2.2-1.3z",
    // Center circle (exactly centered on 10,10)
    "M10 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  ],
  "chevron-right": "M7 4l6 6-6 6",
  copy: "M6 4h8a2 2 0 0 1 2 2v8M4 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4V8z",
  plus: "M10 4v12M4 10h12",
  x: "M5 5l10 10M15 5L5 15",
  clock: "M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 3v5l3.5 2",
  "arrow-left": "M15 10H5m0 0l4-4m-4 4l4 4",
  "clipboard-check": "M7 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1m-6 0h6m-6 0H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-2M7.5 11l2 2 3.5-4",
  "external-link": "M11 3h6v6m0-6L9 11M7 5H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3",
  upload: "M10 14V3m0 0L6 7m4-4l4 4M3 14v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2",
  download: "M10 3v11m0 0l4-4m-4 4L6 10M3 14v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2",
  map: "M3 5l5-2 4 2 5-2v12l-5 2-4-2-5 2V5zm5-2v12m4-10v12",
  "book-open": [
    "M3 4h5c1.1 0 2 .9 2 2v10c0-1.1-.9-2-2-2H3V4z",
    "M17 4h-5c-1.1 0-2 .9-2 2v10c0-1.1.9-2 2-2h5V4z",
  ],
  mail: [
    "M3 5h14v10H3V5z",
    "M3 5.5l7 5 7-5",
  ],
};

export function Icon({ name, size = 20, className }: IconProps) {
  const d = paths[name];
  const pathList = Array.isArray(d) ? d : [d];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {pathList.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}
