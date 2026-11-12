import type { JSONContent } from '@tiptap/core';

export interface Folder { path: string; name: string; specialUse: string | null; total: number; unseen: number }
export interface Addr { name: string; address: string }
export interface MessageSummary {
  id: string; subject: string; from: Addr; date: string | null;
  seen: boolean; flagged: boolean; hasAttachment: boolean;
}
export interface MessageList { uidValidity: string; total: number; items: MessageSummary[] }
export interface MessageFull {
  id: string; subject: string; from: Addr[]; to: Addr[]; cc: Addr[]; bcc?: Addr[]; date: string | null;
  text: string; html: string | null;
  attachments: { part: string; filename: string; size: number; contentType: string; inline: boolean }[];
}

export const PAGE_SIZE = 25;

export interface ContactEmail { email: string; label: '' | 'work' | 'home' | 'other' | string }
export interface ContactDraft { displayName: string; company: string; phone: string; emails: ContactEmail[] }
export interface Contact extends ContactDraft { id: string }
export interface Suggestion { name: string; email: string; source: 'contact' | 'recent' }
export interface Preferences {
  displayName: string; theme: 'system' | 'light' | 'dark'; density: 'comfortable' | 'compact'; timeZone: string;
  rememberRecipients: boolean; onboarded: boolean;
}
export interface SignatureRecord { id: string; name: string; content: JSONContent; isDefault: boolean }
export type SignatureDraft = Omit<SignatureRecord, 'id'>;
export interface OutgoingMessage {
  to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; html?: string;
  inlineImages?: { contentId: string; filename: string; contentType: string; data: string }[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// The custom header is our CSRF token-less check (cookie is also SameSite=Strict).
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'foxalora', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg: unknown = res.statusText;
    // API error shape: { error: { code, message, requestId } }
    try { const body = await res.json(); msg = body?.error?.message ?? msg; } catch { /* ignore */ }
    throw new ApiError(res.status, String(msg));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

const q = (o: Record<string, string | number>) =>
  '?' + new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  login: (email: string, password: string) => call<{ email: string }>('POST', '/auth/login', { email, password }),
  logout: () => call<void>('POST', '/auth/logout'),
  me: () => call<{ email: string }>('GET', '/auth/me'),
  folders: () => call<Folder[]>('GET', '/mailboxes'),
  list: (folder: string, page: number, search = '') =>
    call<MessageList>('GET', `/messages${q({ folder, page, pageSize: PAGE_SIZE, ...(search ? { q: search } : {}) })}`),
  // Message ids are opaque (folder + UIDVALIDITY + UID); a 409 folder_reset means reload the list.
  get: (id: string) => call<MessageFull>('GET', `/messages/${encodeURIComponent(id)}`),
  flag: (id: string, f: { seen?: boolean; flagged?: boolean }) => call<void>('PATCH', `/messages/${encodeURIComponent(id)}`, f),
  /** Moves to Trash (trashId for Undo) or, in Trash, deletes for good (trashId null). */
  remove: (id: string) => call<{ trashId: string | null }>('DELETE', `/messages/${encodeURIComponent(id)}`),
  move: (id: string, folder: string) => call<{ id: string | null }>('POST', `/messages/${encodeURIComponent(id)}/move`, { folder }),
  send: (m: OutgoingMessage & { draftId?: string }) => call<{ status: string }>('POST', '/messages/send', m),
  saveDraft: (m: OutgoingMessage & { replaceId?: string }) => call<{ id: string }>('POST', '/drafts', m),
  deleteDraft: (id: string) => call<void>('DELETE', `/drafts/${encodeURIComponent(id)}`),
  clearRecent: () => call<void>('DELETE', '/contacts/recent'),
  contacts: (search: string, page: number) => call<{ items: Contact[]; total: number }>('GET', `/contacts${q({ page, ...(search ? { q: search } : {}) })}`),
  suggest: (text: string) => call<Suggestion[]>('GET', `/contacts/suggest${q({ q: text })}`),
  createContact: (c: ContactDraft) => call<Contact>('POST', '/contacts', c),
  updateContact: (id: string, c: ContactDraft) => call<Contact>('PUT', `/contacts/${encodeURIComponent(id)}`, c),
  deleteContact: (id: string) => call<void>('DELETE', `/contacts/${encodeURIComponent(id)}`),
  importContacts: (vcard: string, duplicates: 'skip' | 'add') =>
    call<{ imported: number; skipped: number; errors: string[] }>('POST', '/contacts/import', { vcard, duplicates }),
  exportContactsUrl: (ids?: string[]) => `/api/v1/contacts/export${ids?.length ? q({ ids: ids.join(',') }) : ''}`,
  preferences: () => call<Preferences>('GET', '/preferences'),
  savePreferences: (p: Partial<Preferences>) => call<Preferences>('PATCH', '/preferences', p),
  resetPreferences: () => call<void>('DELETE', '/preferences'),
  signatures: () => call<SignatureRecord[]>('GET', '/signatures'),
  createSignature: (s: SignatureDraft) => call<SignatureRecord>('POST', '/signatures', s),
  updateSignature: (id: string, s: SignatureDraft) => call<SignatureRecord>('PUT', `/signatures/${encodeURIComponent(id)}`, s),
  deleteSignature: (id: string) => call<void>('DELETE', `/signatures/${encodeURIComponent(id)}`),
  attachmentUrl: (id: string, part: string) =>
    `/api/v1/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(part)}`,
};
