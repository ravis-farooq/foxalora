// Small stroke icons drawn for Foxalora (24x24 grid, currentColor). No icon library needed.
import type { ReactNode } from 'react';

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const letter = (ch: string, extra: object = {}) => (
  <text x="12" y="17" textAnchor="middle" fontSize="15" fontFamily="Georgia, serif" fill="currentColor" stroke="none" {...extra}>
    {ch}
  </text>
);

export const Icon = {
  undo: svg(<><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>),
  redo: svg(<><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></>),
  bold: svg(letter('B', { fontWeight: 700, fontFamily: 'Arial, sans-serif' })),
  italic: svg(letter('I', { fontStyle: 'italic' })),
  underline: svg(<>{letter('U', { y: 15, fontFamily: 'Arial, sans-serif' })}<path d="M6 21h12" /></>),
  strike: svg(<>{letter('S', { fontFamily: 'Arial, sans-serif' })}<path d="M4 12h16" /></>),
  size: svg(<><path d="M4 7V5h10v2M9 5v14M7 19h4" /><path d="M14 12v-1h6v1M17 11v8M16 19h2" /></>),
  textColor: svg(<><path d="m6 16 6-12 6 12M8.5 11h7" /><path d="M4 20h16" strokeWidth="3" className="fx-swatch" /></>),
  alignLeft: svg(<path d="M4 6h16M4 10h10M4 14h16M4 18h10" />),
  alignCenter: svg(<path d="M4 6h16M7 10h10M4 14h16M7 18h10" />),
  alignRight: svg(<path d="M4 6h16M10 10h10M4 14h16M10 18h10" />),
  alignJustify: svg(<path d="M4 6h16M4 10h16M4 14h16M4 18h16" />),
  listNumber: svg(<><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 5h1v4M4 9h2M4 14.5a1 1 0 0 1 2 0c0 1-2 2-2 3h2" /></>),
  listBullet: svg(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>),
  outdent: svg(<><path d="M11 6h9M11 12h9M4 18h16M4 6h3" /><path d="m7 9-3 3 3 3" /></>),
  indent: svg(<><path d="M11 6h9M11 12h9M4 18h16M4 6h3" /><path d="m4 9 3 3-3 3" /></>),
  quote: svg(<><path d="M7 7H4v5h3v-1a3 3 0 0 1-3 3" /><path d="M17 7h-3v5h3v-1a3 3 0 0 1-3 3" /><path d="M7 12v5M17 12v5" opacity="0" /></>),
  clear: svg(<><path d="M6 5h12M12 5l-3 14M15 13l5 5M20 13l-5 5" /></>),
  link: svg(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>),
  unlink: svg(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /><path d="M4 4l16 16" /></>),
  image: svg(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 17-5-5-9 8" /></>),
  table: svg(<><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 10h18M3 15h18M9 4v16M15 4v16" /></>),
  signature: svg(<><path d="M3 17c3-1 4-8 6-8s-1 8 1 8 3-4 4-4 1 3 3 3 2-1 4-1" /><path d="M3 21h18" /></>),
  direction: svg(<><path d="M9 4v10M13 4v10M9 4h6M8 4a3 3 0 0 0 0 6h1" /><path d="M4 19h16M7 16l-3 3 3 3M17 16l3 3-3 3" /></>),
  hr: svg(<path d="M4 12h16" />),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  chevron: <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>,
  format: svg(<>{letter('A', { fontFamily: 'Arial, sans-serif', y: 15 })}<path d="M5 20h14" /></>),
  more: svg(<><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></>),
  trash: svg(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>),
  external: svg(<><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v6H4V6h6" /></>),
};
