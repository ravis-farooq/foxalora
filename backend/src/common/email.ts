/** Address check shared by sending and contacts: one @, a dot in the domain, no spaces or brackets. */
export const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
export const MAX_EMAIL_LENGTH = 320;
// eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
export const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
