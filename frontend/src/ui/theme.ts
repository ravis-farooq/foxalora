export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'fx-theme';

// The account preference (server) is the source of truth. A copy of an explicit choice is
// kept in this browser only so the first paint after a reload is already in that theme.
// Storage can be blocked (private windows), so every access is guarded.
function stored(): 'light' | 'dark' | null {
  try {
    // eslint-disable-next-line no-restricted-globals -- only the light/dark choice, never mailbox data
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/** Call once before the first render so the page does not flash in the wrong theme. */
export function applyInitialTheme() {
  const t = stored();
  if (t) document.documentElement.dataset.theme = t;
}

/** 'system' follows the operating system (no data-theme attribute; CSS media query decides). */
export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    // eslint-disable-next-line no-restricted-globals -- only the light/dark choice, never mailbox data
    if (pref === 'system') localStorage.removeItem(KEY);
    // eslint-disable-next-line no-restricted-globals -- only the light/dark choice, never mailbox data
    else localStorage.setItem(KEY, pref);
  } catch {
    /* storage blocked: the account preference still applies after sign-in */
  }
}

/** The theme actually on screen. */
export function effectiveTheme(): 'light' | 'dark' {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
