import { normalizeDomain } from '../registry/registry.service';
import { isProduction, ServerValidationError, validateServerInput, type ServerInput } from '../registry/server-validation';
import { adminPasswordProblem } from './admin-password';

export const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const MAX_DOMAINS = 100;

export interface SetupInput {
  organisation: string;
  admin: { email: string; password: string };
  server: ServerInput;
  domains: string[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

/** Mail server fields of the wizard. The registry name defaults to the IMAP host. */
export function parseServer(v: unknown): ServerInput {
  const s = obj(v);
  const imapHost = String(s.imapHost ?? '').trim().toLowerCase();
  return validateServerInput({
    name: (typeof s.name === 'string' && s.name.trim()) || imapHost || 'mail',
    imapHost,
    imapPort: Number(s.imapPort),
    imapTls: s.imapTls as ServerInput['imapTls'],
    smtpHost: String(s.smtpHost ?? '').trim().toLowerCase() || imapHost,
    smtpPort: Number(s.smtpPort),
    smtpTls: s.smtpTls as ServerInput['smtpTls'],
    allowPrivate: s.allowPrivate === true,
    savesSent: s.savesSent === true,
  }, { production: isProduction() });
}

/** Optional mailbox for the connection test. Used once, never stored. */
export function parseTestMailbox(v: unknown): { user: string; pass: string } | undefined {
  const m = obj(v);
  const email = typeof m.email === 'string' ? m.email.trim() : '';
  const password = typeof m.password === 'string' ? m.password : '';
  if (!email && !password) return undefined;
  if (!EMAIL_RE.test(email) || email.length > 320) throw new ServerValidationError('The test email address is not valid.');
  if (!password || password.length > 1024) throw new ServerValidationError('Enter the password of the test mailbox.');
  return { user: email, pass: password };
}

export function parseSetupInput(body: unknown): SetupInput {
  const b = obj(body);
  const organisation = typeof b.organisation === 'string' ? b.organisation.trim() : '';
  if (!organisation || organisation.length > 200) throw new ServerValidationError('Enter your company name (at most 200 characters).');

  const a = obj(b.admin);
  const email = typeof a.email === 'string' ? a.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 320) throw new ServerValidationError('The administrator email address is not valid.');
  const problem = adminPasswordProblem(a.password, email);
  if (problem) throw new ServerValidationError(problem);

  const list = Array.isArray(b.domains) ? b.domains : [];
  const domains = [...new Set(list.map((d) => normalizeDomain(d)))];
  if (!domains.length) throw new ServerValidationError('Add at least one email domain.');
  if (domains.length > MAX_DOMAINS) throw new ServerValidationError(`At most ${MAX_DOMAINS} domains can be added here; add more later.`);

  return { organisation, admin: { email, password: a.password as string }, server: parseServer(b.server), domains };
}
