import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, Folder, MessageFull, MessageSummary, PAGE_SIZE } from '../api';
import { folderIcon, folderLabel, restoreTarget, sortFolders } from '../mail/folders';
import { avatarOf, displayName, formatAddr, forwardSubject, fullDate, replyAllRecipients, replySubject, shortDate } from '../mail/format';
import { Icon, Logo } from '../ui/icons';
import { Menu } from '../ui/Menu';
import { useConfirm } from '../ui/confirm-context';
import { useToast } from '../ui/toast-context';
import type { ComposeInit } from './Compose';
import MessageView from './MessageView';

interface ListState { items: MessageSummary[]; total: number }

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// m.html was sanitized by the server; plain-text messages are escaped here.
const quotedHtml = (m: MessageFull) => m.html ?? esc(m.text).replace(/\n/g, '<br>');

export default function Mailbox({ email, onCompose, version }: { email: string; onCompose: (init: ComposeInit) => void; version: number }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState('INBOX');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(''); // text in the box
  const [query, setQuery] = useState(''); // search that produced the list
  const [list, setList] = useState<ListState>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<MessageFull | null>(null);
  const [msgError, setMsgError] = useState('');
  const [drawer, setDrawer] = useState(false);
  // Only the newest list or message request may update the screen.
  const listSeq = useRef(0);
  const openSeq = useRef(0);
  // Where the list is, for refreshes started elsewhere (a draft saved, a message sent).
  const view = useRef({ folder: 'INBOX', page: 1, query: '' });
  // Where messages deleted in this session came from (Trash id -> folder), for Restore.
  const origins = useRef(new Map<string, string>());

  const current = folders.find((f) => f.path === folder);
  const label = current ? folderLabel(current) : folder === 'INBOX' ? 'Inbox' : folder;
  const summary = list.items.find((m) => m.id === selected);
  const inDrafts = current?.specialUse === '\\Drafts';
  const inTrash = current?.specialUse === '\\Trash';

  const loadFolders = useCallback(() => {
    api.folders().then(setFolders, (e: Error) => toast('error', e.message));
  }, [toast]);

  const loadList = useCallback(
    (f: string, p: number, q: string) => {
      view.current = { folder: f, page: p, query: q };
      const seq = ++listSeq.current;
      setLoading(true);
      setListError('');
      api
        .list(f, p, q)
        .then((r) => seq === listSeq.current && setList({ items: r.items, total: r.total }))
        .catch((e: Error) => seq === listSeq.current && setListError(e.message))
        .finally(() => seq === listSeq.current && setLoading(false));
    },
    [],
  );

  // First load only; later loads are started by the user's actions.
  useEffect(() => {
    loadFolders();
    const seq = ++listSeq.current;
    api
      .list('INBOX', 1)
      .then((r) => seq === listSeq.current && setList({ items: r.items, total: r.total }))
      .catch((e: Error) => seq === listSeq.current && setListError(e.message))
      .finally(() => seq === listSeq.current && setLoading(false));
  }, [loadFolders]);

  // Another part of the app changed mail (draft saved, message sent): refresh counts and the list.
  useEffect(() => {
    if (!version) return;
    loadFolders();
    const { folder: f, page: p, query: q } = view.current;
    const seq = ++listSeq.current;
    api.list(f, p, q).then((r) => seq === listSeq.current && setList({ items: r.items, total: r.total }), () => undefined);
  }, [version, loadFolders]);

  // Phone layout: Escape closes the folder drawer.
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  const closeMessage = () => {
    openSeq.current++;
    setSelected(null);
    setMsg(null);
    setMsgError('');
  };

  function openFolder(path: string) {
    setFolder(path);
    setPage(1);
    setSearch('');
    setQuery('');
    setDrawer(false);
    closeMessage();
    loadList(path, 1, '');
  }

  function goToPage(p: number) {
    setPage(p);
    loadList(folder, p, query);
  }

  function runSearch(e: FormEvent) {
    e.preventDefault();
    const q = search.trim();
    setQuery(q);
    setPage(1);
    closeMessage();
    loadList(folder, 1, q);
  }

  function clearSearch() {
    setSearch('');
    if (!query) return;
    setQuery('');
    setPage(1);
    loadList(folder, 1, '');
  }

  function refresh() {
    loadFolders();
    loadList(folder, page, query);
  }

  const patchItem = (id: string, change: Partial<MessageSummary>) =>
    setList((l) => ({ ...l, items: l.items.map((x) => (x.id === id ? { ...x, ...change } : x)) }));
  const bumpUnseen = (delta: number) =>
    setFolders((fs) => fs.map((f) => (f.path === folder ? { ...f, unseen: Math.max(0, f.unseen + delta) } : f)));

  function openMessage(m: MessageSummary) {
    const seq = ++openSeq.current;
    setSelected(m.id);
    setMsg(null);
    setMsgError('');
    api.get(m.id).then(
      (full) => {
        if (seq !== openSeq.current) return;
        setMsg(full);
        // The server marks a message read when its body is fetched.
        if (!m.seen) {
          patchItem(m.id, { seen: true });
          bumpUnseen(-1);
        }
      },
      (e: Error) => {
        if (seq !== openSeq.current) return;
        if (e instanceof ApiError && e.status === 409) {
          toast('info', 'This folder changed on the server. The list was reloaded.');
          closeMessage();
          loadList(folder, 1, query);
        } else setMsgError(e.message);
      },
    );
  }

  function quote(m: MessageFull, header: string) {
    return { header, html: quotedHtml(m), text: m.text };
  }

  function reply(all: boolean) {
    if (!msg) return;
    const from = msg.from[0];
    const header = `On ${fullDate(msg.date)}, ${from ? formatAddr(from) : 'someone'} wrote:`;
    const recipients = all ? replyAllRecipients(msg, email) : { to: from ? [from.address] : [], cc: [] };
    onCompose({
      title: all ? 'Reply all' : 'Reply',
      to: recipients.to.join(', '),
      cc: recipients.cc.join(', '),
      subject: replySubject(msg.subject),
      quoted: quote(msg, header),
    });
  }

  function forward() {
    if (!msg) return;
    const header = [
      '---------- Forwarded message ---------',
      `From: ${msg.from.map(formatAddr).join(', ')}`,
      `Date: ${fullDate(msg.date)}`,
      `Subject: ${msg.subject}`,
      `To: ${msg.to.map(formatAddr).join(', ')}`,
      ...(msg.cc.length ? [`Cc: ${msg.cc.map(formatAddr).join(', ')}`] : []),
    ].join('\n');
    const files = msg.attachments.filter((a) => !a.inline).length;
    onCompose({
      title: 'Forward',
      subject: forwardSubject(msg.subject),
      quoted: quote(msg, header),
      note: files ? `The original ${files === 1 ? 'attachment is' : `${files} attachments are`} not forwarded yet. Download and attach them once attachments are supported.` : undefined,
    });
  }

  async function remove() {
    if (!selected) return;
    const id = selected;
    const from = folder;
    const ok = inTrash
      ? await confirm({
          title: 'Delete this message for good?',
          message: 'It is already in Trash, so it cannot be restored afterwards.',
          confirmLabel: 'Delete for good',
          danger: true,
        })
      : await confirm({
          title: 'Move this message to Trash?',
          message: 'You can restore it from Trash later.',
          confirmLabel: 'Move to Trash',
        });
    if (!ok) return;
    try {
      const { trashId } = await api.remove(id);
      setList((l) => ({ items: l.items.filter((x) => x.id !== id), total: Math.max(0, l.total - 1) }));
      closeMessage();
      loadFolders();
      if (inTrash) {
        toast('success', 'Message deleted for good.');
        return;
      }
      if (trashId) origins.current.set(trashId, from);
      toast('success', 'Message moved to Trash.', trashId ? {
        label: 'Undo',
        run: () => {
          api.move(trashId, from).then(
            () => {
              origins.current.delete(trashId);
              toast('success', 'Message restored.');
              loadFolders();
              loadList(view.current.folder, view.current.page, view.current.query);
            },
            (e: Error) => toast('error', e.message),
          );
        },
      } : undefined);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }

  /** Trash: move the open message back where it came from (or to the Inbox). */
  async function restore() {
    if (!selected) return;
    const id = selected;
    const target = restoreTarget(folders, origins.current.get(id));
    if (!target) {
      toast('error', 'There is no Inbox to restore the message to.');
      return;
    }
    try {
      await api.move(id, target.path);
      origins.current.delete(id);
      setList((l) => ({ items: l.items.filter((x) => x.id !== id), total: Math.max(0, l.total - 1) }));
      closeMessage();
      loadFolders();
      toast('success', `Message restored to ${folderLabel(target)}.`, { label: `Open ${folderLabel(target)}`, run: () => openFolder(target.path) });
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }

  function continueDraft() {
    if (!msg) return;
    const list = (a?: { name: string; address: string }[]) => (a ?? []).map((x) => x.address).join(', ');
    onCompose({
      title: 'Draft',
      to: list(msg.to),
      cc: list(msg.cc),
      bcc: list(msg.bcc),
      subject: msg.subject === '(no subject)' ? '' : msg.subject,
      initialHtml: quotedHtml(msg),
      draftId: msg.id,
    });
  }

  async function mark(change: { seen?: boolean; flagged?: boolean }) {
    if (!selected || !summary) return;
    const id = selected;
    const before = summary;
    patchItem(id, change);
    if (change.seen !== undefined && change.seen !== before.seen) bumpUnseen(change.seen ? -1 : 1);
    try {
      await api.flag(id, change);
    } catch (e) {
      patchItem(id, { seen: before.seen, flagged: before.flagged });
      if (change.seen !== undefined && change.seen !== before.seen) bumpUnseen(change.seen ? 1 : -1);
      toast('error', (e as Error).message);
    }
  }

  const first = list.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, list.total);
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const sorted = sortFolders(folders);

  return (
    <main id="main" tabIndex={-1} className={`mail-view ${drawer ? 'drawer-open' : ''} ${selected ? 'has-message' : ''}`}>
      <aside className="folders" aria-label="Folders" data-guide="folders">
        <div className="pane-head account">
          <span className="avatar small" style={{ '--h': avatarOf({ name: '', address: email }).hue } as CSSProperties} aria-hidden="true">
            {avatarOf({ name: '', address: email }).letter}
          </span>
          <span className="ellipsis" title={email}>{email}</span>
          <button type="button" className="icon-btn only-mobile" aria-label="Close folders" onClick={() => setDrawer(false)}>{Icon.x}</button>
        </div>
        <ul className="folder-list">
          {sorted.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                className={`folder ${f.path === folder ? 'active' : ''} ${f.unseen > 0 ? 'has-unread' : ''}`}
                aria-current={f.path === folder ? 'true' : undefined}
                onClick={() => openFolder(f.path)}
              >
                {Icon[folderIcon(f)]}
                <span className="folder-name ellipsis">{folderLabel(f)}</span>
                {f.unseen > 0 && <span className="count" aria-label={`${f.unseen} unread`}>{f.unseen}</span>}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}

      <section className="list" aria-label={`${label} messages`}>
        <div className="pane-head">
          <button type="button" className="icon-btn only-mobile" aria-label="Show folders" onClick={() => setDrawer(true)}>{Icon.menu}</button>
          <form role="search" className="search" onSubmit={runSearch} data-guide="search">
            {Icon.search}
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label}`}
              aria-label={`Search ${label}`}
              maxLength={100}
            />
            {(search || query) && (
              <button type="button" className="icon-btn" aria-label="Clear search" onClick={clearSearch}>{Icon.x}</button>
            )}
          </form>
          <button type="button" className="icon-btn" aria-label="Refresh" data-tip="Check for new mail" onClick={refresh}>{Icon.refresh}</button>
        </div>

        <div className="list-title">
          <h1>{label}</h1>
          <span className="muted small">
            {query ? `${list.total} result${list.total === 1 ? '' : 's'} for “${query}”` : `${list.total} message${list.total === 1 ? '' : 's'}`}
          </span>
        </div>

        <div className="list-body" aria-busy={loading}>
          {listError && (
            <div className="notice error" role="alert">
              {Icon.alert}<span>{listError}</span>
              <button type="button" className="link" onClick={refresh}>Try again</button>
            </div>
          )}
          {loading && !list.items.length && !listError && <Skeleton />}
          {list.items.length > 0 && (
            <ul className="msg-list">
              {list.items.map((m) => {
                const av = avatarOf(m.from);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      className={`msg-row ${m.seen ? '' : 'unread'} ${selected === m.id ? 'active' : ''}`}
                      aria-current={selected === m.id ? 'true' : undefined}
                      onClick={() => openMessage(m)}
                    >
                      <span className="avatar" style={{ '--h': av.hue } as CSSProperties} aria-hidden="true">{av.letter}</span>
                      <span className="msg-main">
                        <span className="msg-line">
                          <span className="msg-from ellipsis" dir="auto">{displayName(m.from)}</span>
                          <time className="msg-date" dateTime={m.date ?? undefined}>{shortDate(m.date)}</time>
                        </span>
                        <span className="msg-line">
                          <span className="msg-subject ellipsis" dir="auto">{m.subject}</span>
                          <span className="msg-icons">
                            {m.hasAttachment && <span title="Has attachments">{Icon.paperclip}</span>}
                            {m.flagged && <span className="flagged" title="Starred">{Icon.star}</span>}
                          </span>
                        </span>
                      </span>
                      {!m.seen && <span className="sr-only">Unread</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!loading && !listError && !list.items.length && (
            <div className="empty">
              {query ? Icon.search : Icon.inbox}
              <strong>{query ? 'No messages match your search' : 'The list is empty'}</strong>
              {query && <button type="button" className="link" onClick={clearSearch}>Clear search</button>}
            </div>
          )}
        </div>

        <footer className="pager" aria-label="Pages">
          <button type="button" className="icon-btn" aria-label="First page" disabled={page <= 1 || loading} onClick={() => goToPage(1)}>{Icon.chevronsLeft}</button>
          <button type="button" className="icon-btn" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>{Icon.chevronLeft}</button>
          <span>{list.total ? `${first}–${last} of ${list.total}` : 'No messages'}</span>
          <button type="button" className="icon-btn" aria-label="Next page" disabled={page >= pages || loading} onClick={() => goToPage(page + 1)}>{Icon.chevronRight}</button>
          <button type="button" className="icon-btn" aria-label="Last page" disabled={page >= pages || loading} onClick={() => goToPage(pages)}>{Icon.chevronsRight}</button>
        </footer>
      </section>

      <section className="reader" aria-label="Message">
        <div className="pane-head toolbar" role="toolbar" aria-label="Message actions" data-guide="toolbar">
          <button type="button" className="icon-btn only-mobile" aria-label="Back to list" onClick={closeMessage}>{Icon.back}</button>
          {inTrash && (
            <>
              <ToolButton
                icon={Icon.restore}
                label="Restore"
                tip="Move this message back to the folder it was deleted from, or to Inbox"
                disabled={!selected}
                onClick={restore}
              />
              <span className="tool-sep" />
            </>
          )}
          {inDrafts ? (
            <ToolButton icon={Icon.pen} label="Continue writing" tip="Open this draft to finish and send it" disabled={!msg} onClick={continueDraft} />
          ) : (
            <>
              <ToolButton icon={Icon.reply} label="Reply" tip="Reply to the sender" disabled={!msg} onClick={() => reply(false)} />
              <ToolButton icon={Icon.replyAll} label="Reply all" tip="Reply to the sender and everyone else on the message" disabled={!msg} onClick={() => reply(true)} />
              <ToolButton icon={Icon.forward} label="Forward" tip="Send this message on to someone else" disabled={!msg} onClick={forward} />
            </>
          )}
          <span className="tool-sep" />
          <ToolButton icon={Icon.trash} label={inTrash ? 'Delete for good' : 'Delete'} tip={inTrash ? 'Delete for good. This cannot be undone.' : 'Move to Trash. You can restore it later.'} disabled={!selected} onClick={remove} />
          <Menu
            label="Mark"
            icon={Icon.tag}
            tip="Mark as read or unread, or add a star"
            disabled={!summary}
            items={[
              summary?.seen
                ? { label: 'Mark as unread', icon: Icon.mail, onSelect: () => mark({ seen: false }) }
                : { label: 'Mark as read', icon: Icon.mailOpen, onSelect: () => mark({ seen: true }) },
              summary?.flagged
                ? { label: 'Remove star', icon: Icon.star, onSelect: () => mark({ flagged: false }) }
                : { label: 'Add star', icon: Icon.star, onSelect: () => mark({ flagged: true }) },
            ]}
          />
        </div>

        <div className="reader-body">
          {msgError ? (
            <div className="notice error" role="alert">{Icon.alert}<span>{msgError}</span></div>
          ) : msg && summary ? (
            <MessageView msg={msg} flagged={summary.flagged} onToggleFlag={() => mark({ flagged: !summary.flagged })} />
          ) : selected ? (
            <div className="reader-empty"><span className="muted">Loading message…</span></div>
          ) : (
            <div className="reader-empty">
              <Logo size={160} className="watermark" />
              <span className="muted">Select a message to read it</span>
            </div>
          )}
        </div>
      </section>

    </main>
  );
}

function ToolButton({ icon, label, tip, disabled, onClick }: { icon: ReactNode; label: string; tip?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="tool-btn" disabled={disabled} onClick={onClick} data-tip={tip ?? label}>
      {icon}
      <span className="tool-label">{label}</span>
    </button>
  );
}

function Skeleton() {
  return (
    <ul className="msg-list" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="msg-row skeleton-row">
          <span className="avatar skeleton" />
          <span className="msg-main">
            <span className="skeleton" style={{ width: '45%' }} />
            <span className="skeleton" style={{ width: '80%' }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
