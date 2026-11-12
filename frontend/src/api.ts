export interface Folder { path: string; name: string; specialUse: string | null; total: number; unseen: number }
export interface Addr { name: string; address: string }
export interface MessageSummary {
  id: string; subject: string; from: Addr; date: string | null;
  seen: boolean; flagged: boolean; hasAttachment: boolean;
}
export interface MessageList { uidValidity: string; total: number; items: MessageSummary[] }
export interface MessageFull {
  id: string; subject: string; from: Addr[]; to: Addr[]; cc: Addr[]; date: string | null;
  text: string; html: string | null;
  attachments: { part: string; filename: string; size: number; contentType: string; inline: boolean }[];
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
  list: (folder: string, page: number) => call<MessageList>('GET', `/messages${q({ folder, page, pageSize: 25 })}`),
  // Message ids are opaque (folder + UIDVALIDITY + UID); a 409 folder_reset means reload the list.
  get: (id: string) => call<MessageFull>('GET', `/messages/${encodeURIComponent(id)}`),
  flag: (id: string, f: { seen?: boolean; flagged?: boolean }) => call<void>('PATCH', `/messages/${encodeURIComponent(id)}`, f),
  remove: (id: string) => call<void>('DELETE', `/messages/${encodeURIComponent(id)}`),
  send: (m: {
    to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; html?: string;
    inlineImages?: { contentId: string; filename: string; contentType: string; data: string }[];
  }) => call<{ status: string }>('POST', '/messages/send', m),
  attachmentUrl: (id: string, part: string) =>
    `/api/v1/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(part)}`,
};
