// App icons, drawn for Foxalora in the same style as the editor icons (24x24 grid, 2px
// stroke, currentColor). No icon library needed.
import type { ReactNode } from 'react';

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const Icon = {
  compose: svg(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>),
  mail: svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
  mailOpen: svg(<><path d="M3 10v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9" /><path d="m3 10 9-7 9 7" /><path d="m3 10 9 6 9-6" /></>),
  inbox: svg(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z" /></>),
  send: svg(<><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4Z" /></>),
  drafts: svg(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6" /><path d="M9 14h6M9 17.5h4" /></>),
  junk: svg(<><path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9Z" /><path d="M12 8v4M12 16h.01" /></>),
  trash: svg(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></>),
  archive: svg(<><rect x="2" y="3" width="20" height="5" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></>),
  folder: svg(<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />),
  folderPlus: svg(<><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M12 10v6M9 13h6" /></>),
  move: svg(<><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="m12 10 3 3-3 3M8 13h7" /></>),
  moreVertical: svg(<><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></>),
  star: svg(<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z" />),
  paperclip: svg(<path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15.5 7" />),
  reply: svg(<><path d="M9 17 4 12l5-5" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></>),
  replyAll: svg(<><path d="M7 17 2 12l5-5" /><path d="m12 17-5-5 5-5" /><path d="M22 18v-2a4 4 0 0 0-4-4H7" /></>),
  forward: svg(<><path d="m15 17 5-5-5-5" /><path d="M4 18v-2a4 4 0 0 1 4-4h12" /></>),
  tag: svg(<><path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4Z" /><circle cx="7.5" cy="7.5" r="1.5" /></>),
  flag: svg(<><path d="M4 22V4" /><path d="M4 4h13l-2 4 2 4H4" /></>),
  refresh: svg(<><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" /><path d="M21 3v5h-5" /></>),
  restore: svg(<><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5" /><path d="M12 8v4l3 2" /></>),
  search: svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  x: svg(<path d="M18 6 6 18M6 6l12 12" />),
  sun: svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  moon: svg(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />),
  power: svg(<><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.8 0" /></>),
  info: svg(<><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>),
  help: svg(<><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>),
  alert: svg(<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>),
  check: svg(<path d="M20 6 9 17l-5-5" />),
  chevronLeft: svg(<path d="m15 18-6-6 6-6" />),
  chevronRight: svg(<path d="m9 18 6-6-6-6" />),
  chevronsLeft: svg(<path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />),
  chevronsRight: svg(<path d="m13 17 5-5-5-5M6 17l5-5-5-5" />),
  chevronDown: svg(<path d="m6 9 6 6 6-6" />),
  back: svg(<path d="M19 12H5M12 19l-7-7 7-7" />),
  menu: svg(<path d="M4 6h16M4 12h16M4 18h16" />),
  download: svg(<><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>),
  upload: svg(<><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M5 21h14" /></>),
  contacts: svg(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>),
  settings: svg(<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />),
  user: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></>),
  palette: svg(<><path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3-4 3h-2a2 2 0 0 0-1.5 3.3A2 2 0 0 1 12 22Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7" r="1" /><circle cx="15.5" cy="7.5" r="1" /></>),
  pen: svg(<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  phone: svg(<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />),
  building: svg(<><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" /></>),
};

export type IconName = keyof typeof Icon;

/** Foxalora mark: a fox head whose chin is an envelope flap. */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false" className={className}>
      <path d="M4 5l7 6h10l7-6v10c0 7-5.4 12-12 12S4 22 4 15Z" fill="currentColor" />
      <path d="M10 17.5l6 4 6-4" fill="none" stroke="var(--logo-cut, #fff)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
