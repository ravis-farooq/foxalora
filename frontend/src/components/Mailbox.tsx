import { useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { api, ApiError, type BulkAction, type Folder, type MessageFull, type MessageSummary, PAGE_SIZE } from '../api';
import { folderIcon, folderLabel, folderRows, formatBytes, isProtected, moveTargets, restoreTarget } from '../mail/folders';
import { avatarOf, displayName, formatAddr, forwardSubject, fullDate, replyAllRecipients, replySubject, shortDate } from '../mail/format';
import { useConfirm } from '../ui/confirm-context';
import { Icon, Logo } from '../ui/icons';
import { Menu, type MenuItem } from '../ui/Menu';
import { useToast } from '../ui/toast-context';
import type { ComposeInit } from './Compose';
import FolderDialog from './FolderDialog';
import MessageView from './MessageView';

interface ListState { items: MessageSummary[]; total: number }
type Dialog = { mode: 'create'; parent?: Folder } | { mode: 'rename'; folder: Folder } | null;

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// m.html was sanitized by the server; plain-text messages are escaped here.
const quotedHtml = (m: MessageFull) => m.html ?? esc(m.text).replace(/\n/g, '<br>');
const DRAG_TYPE = 'application/x-foxalora-messages';
const count = (n: number, one: string) => (n === 1 ? one : `${n} messages`);

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
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [quota, setQuota] = useState<{ used: number; limit: number | null } | null>(null);
  // Only the newest list or message request may update the screen.
  const listSeq = useRef(0);
  const openSeq = useRef(0);
  // Where the list is, for refreshes started elsewhere (a draft saved, a message sent).
  const view = useRef({ folder: 'INBOX', page: 1, query: '' });
  // Where messages deleted in this session came from (Trash id -> folder), for Restore.
  // A stable Map (never re-renders); kept in state so menu callbacks built during render may use it.
  const [origins] = useState(() => new Map<string, string>());
  const lastChecked = useRef<string | null>(null);

  const current = folders.find((f) => f.path === folder);
  const role = current?.specialUse;
  const label = current ? folderLabel(current) : folder === 'INBOX' ? 'Inbox' : folder;
  const summary = list.items.find((m) => m.id === selected);
  const inDrafts = role === '\\Drafts';
  const inTrash = role === '\\Trash';
  const inJunk = role === '\\Junk';
  const inArchive = role === '\\Archive';
  // Sent and Drafts list who a message is for, like other mail apps.
  const showRecipient = role === '\\Sent' || inDrafts;
  const delimiter = folders[0]?.delimiter ?? '/';

  const loadFolders = useCallback(() => {
    api.folders().then(setFolders, (e: Error) => toast('error', e.message));
    api.quota().then((r) => setQuota(r.quota), () => undefined);
  }, [toast]);

  const loadList = useCallback((f: string, p: number, q: string) => {
    view.current = { folder: f, page: p, query: q };
    const seq = ++listSeq.current;
    setLoading(true);
    setListError('');
    setChecked(new Set());
    api
      .list(f, p, q)
      .then((r) => seq === listSeq.current && setList({ items: r.items, total: r.total }))
      .catch((e: Error) => seq === listSeq.current && setListError(e.message))
      .finally(() => seq === listSeq.current && setLoading(false));
  }, []);

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

  // ---- Selection (tick boxes) ----
  function toggleCheck(id: string, e?: MouseEvent) {
    setChecked((prev) => {
      const next = new Set(prev);
      const on = !next.has(id);
      // Shift-click selects everything between the last ticked message and this one.
      if (e?.shiftKey && lastChecked.current) {
        const ids = list.items.map((m) => m.id);
        const [a, b] = [ids.indexOf(lastChecked.current), ids.indexOf(id)].sort((x, y) => x - y);
        if (a >= 0 && b >= 0) ids.slice(a, b + 1).forEach((x) => (on ? next.add(x) : next.delete(x)));
      } else if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    lastChecked.current = id;
  }
  const allChecked = list.items.length > 0 && list.items.every((m) => checked.has(m.id));
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(list.items.map((m) => m.id)));

  // ---- Actions on one or many messages ----
  function undoMove(ids: string[], back: string) {
    api.bulk(ids, 'move', back).then(
      () => {
        ids.forEach((id) => origins.delete(id));
        toast('success', ids.length === 1 ? 'Message restored.' : `${ids.length} messages restored.`);
        loadFolders();
        loadList(view.current.folder, view.current.page, view.current.query);
      },
      (e: Error) => toast('error', e.message),
    );
  }

  async function runBulk(ids: string[], action: BulkAction, target?: string) {
    if (!ids.length) return;
    const n = ids.length;
    if (action === 'delete') {
      const ok = inTrash
        ? await confirm({
            title: `Delete ${count(n, 'this message')} for good?`,
            message: `${n === 1 ? 'It is' : 'They are'} already in Trash, so ${n === 1 ? 'it' : 'they'} cannot be restored afterwards.`,
            confirmLabel: 'Delete for good',
            danger: true,
          })
        : await confirm({ title: `Move ${count(n, 'this message')} to Trash?`, message: 'You can restore from Trash later.', confirmLabel: 'Move to Trash' });
      if (!ok) return;
    }
    const from = folder;
    const flags: Partial<Record<BulkAction, Partial<MessageSummary>>> = { seen: { seen: true }, unseen: { seen: false }, flag: { flagged: true }, unflag: { flagged: false } };
    try {
      const res = await api.bulk(ids, action, target);
      setChecked(new Set());
      if (flags[action]) {
        setList((l) => ({ ...l, items: l.items.map((x) => (ids.includes(x.id) ? { ...x, ...flags[action] } : x)) }));
        loadFolders();
        if (n > 1) toast('success', `${n} messages updated.`);
        return;
      }
      setList((l) => ({ items: l.items.filter((x) => !ids.includes(x.id)), total: Math.max(0, l.total - n) }));
      if (selected && ids.includes(selected)) closeMessage();
      loadFolders();
      if (!res.target) {
        toast('success', `${count(n, 'Message')} deleted for good.`);
        return;
      }
      if (action === 'delete') res.newIds.forEach((id) => origins.set(id, from));
      const dest = folders.find((f) => f.path === res.target);
      const destLabel = dest ? folderLabel(dest) : res.target;
      const done: Partial<Record<BulkAction, string>> = {
        delete: 'moved to Trash', archive: 'archived', junk: 'moved to Junk', notjunk: 'moved to Inbox', move: `moved to ${destLabel}`,
      };
      toast(
        'success',
        `${count(n, 'Message')} ${done[action]}.${res.created ? ' An Archive folder was created for you.' : ''}`,
        res.newIds.length === n ? { label: 'Undo', run: () => undoMove(res.newIds, from) } : undefined,
      );
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }

  /** Trash: move messages back where they came from (known for this session), or to the Inbox. */
  async function restore(ids: string[]) {
    const known = ids.map((id) => origins.get(id));
    const same = known.every((o) => o && o === known[0]) ? known[0] : undefined;
    const target = restoreTarget(folders, same);
    if (!target) return toast('error', 'There is no Inbox to restore to.');
    try {
      await api.bulk(ids, 'move', target.path);
      ids.forEach((id) => origins.delete(id));
      setChecked(new Set());
      setList((l) => ({ items: l.items.filter((x) => !ids.includes(x.id)), total: Math.max(0, l.total - ids.length) }));
      if (selected && ids.includes(selected)) closeMessage();
      loadFolders();
      toast('success', `${count(ids.length, 'Message')} restored to ${folderLabel(target)}.`, { label: `Open ${folderLabel(target)}`, run: () => openFolder(target.path) });
    } catch (e) {
      toast('error', (e as Error).message);
    }
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

  // ---- Compose from a message ----
  const quote = (m: MessageFull, header: string) => ({ header, html: quotedHtml(m), text: m.text });

  function reply(all: boolean) {
    if (!msg) return;
    const from = msg.from[0];
    const header = `On ${fullDate(msg.date)}, ${from ? formatAddr(from) : 'someone'} wrote:`;
    const recipients = all ? replyAllRecipients(msg, email) : { to: from ? [from.address] : [], cc: [] };
    onCompose({ title: all ? 'Reply all' : 'Reply', to: recipients.to.join(', '), cc: recipients.cc.join(', '), subject: replySubject(msg.subject), quoted: quote(msg, header) });
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

  function continueDraft() {
    if (!msg) return;
    const addrs = (a?: { name: string; address: string }[]) => (a ?? []).map((x) => x.address).join(', ');
    onCompose({ title: 'Draft', to: addrs(msg.to), cc: addrs(msg.cc), bcc: addrs(msg.bcc), subject: msg.subject === '(no subject)' ? '' : msg.subject, initialHtml: quotedHtml(msg), draftId: msg.id });
  }

  // ---- Folders ----
  async function createFolder(name: string, parent?: Folder) {
    const { path } = await api.createFolder(name, parent?.path);
    setDialog(null);
    if (parent) setCollapsed((c) => new Set([...c].filter((p) => p !== parent.path)));
    loadFolders();
    toast('success', `Folder “${name}” created.`, { label: 'Open', run: () => openFolder(path) });
  }

  async function renameFolder(f: Folder, name: string) {
    const { path } = await api.renameFolder(f.path, name);
    setDialog(null);
    loadFolders();
    if (folder === f.path || folder.startsWith(f.path + f.delimiter)) openFolder(path + folder.slice(f.path.length));
    toast('success', `Folder renamed to “${name}”.`);
  }

  async function deleteFolder(f: Folder) {
    const ok = await confirm({
      title: `Delete the folder “${folderLabel(f)}”?`,
      message: f.total ? `Its ${f.total} message${f.total === 1 ? ' is' : 's are'} deleted too. This cannot be undone.` : 'This cannot be undone.',
      confirmLabel: 'Delete folder',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteFolder(f.path);
      if (folder === f.path) openFolder('INBOX');
      loadFolders();
      toast('success', `Folder “${folderLabel(f)}” deleted.`);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }

  const folderMenu = (f: Folder): MenuItem[] => [
    { label: 'New folder inside', icon: Icon.folderPlus, onSelect: () => setDialog({ mode: 'create', parent: f }) },
    ...(isProtected(f) ? [] : [
      { label: 'Rename', icon: Icon.pen, onSelect: () => setDialog({ mode: 'rename', folder: f }) },
      { label: 'Delete folder', icon: Icon.trash, danger: true, onSelect: () => deleteFolder(f) },
    ]),
  ];

  // ---- Drag and drop: messages onto folders ----
  function onDragStart(e: DragEvent, m: MessageSummary) {
    const ids = checked.has(m.id) ? [...checked] : [m.id];
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  }
  const canDrop = (f: Folder) => f.selectable && f.path !== folder;
  function onDrop(e: DragEvent, f: Folder) {
    e.preventDefault();
    setDropTarget(null);
    let ids: unknown;
    try {
      ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]');
    } catch {
      return;
    }
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) return;
    if (f.specialUse === '\\Trash') runBulk(ids, 'delete');
    else runBulk(ids, 'move', f.path);
  }

  // Move menu: every other folder, indented like the sidebar.
  const moveItems = (): MenuItem[] =>
    folderRows(moveTargets(folders, folder)).map(({ folder: f, depth }) => ({ label: `${'\u2003'.repeat(depth)}${folderLabel(f)}`, icon: Icon[folderIcon(f)], value: f.path }));
  function moveTo(ids: string[], path?: string) {
    const f = folders.find((x) => x.path === path);
    if (!f) return;
    if (f.specialUse === '\\Trash') runBulk(ids, 'delete');
    else runBulk(ids, 'move', f.path);
  }

  const first = list.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, list.total);
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const rows = folderRows(folders, collapsed);
  const selectedIds = [...checked];
  const anyUnread = list.items.some((m) => checked.has(m.id) && !m.seen);
  const anyUnstarred = list.items.some((m) => checked.has(m.id) && !m.flagged);
  const openIds = () => (selected ? [selected] : []);

  return (
    <main id="main" tabIndex={-1} className={`mail-view ${drawer ? 'drawer-open' : ''} ${selected ? 'has-message' : ''}`}>
      <aside className="folders" aria-label="Folders" data-guide="folders">
        <div className="pane-head account">
          <span className="avatar small" style={{ '--h': avatarOf({ name: '', address: email }).hue } as CSSProperties} aria-hidden="true">
            {avatarOf({ name: '', address: email }).letter}
          </span>
          <span className="ellipsis grow" title={email}>{email}</span>
          <button type="button" className="icon-btn" aria-label="New folder" data-tip="Create a folder to sort your mail" onClick={() => setDialog({ mode: 'create' })}>{Icon.folderPlus}</button>
          <button type="button" className="icon-btn only-mobile" aria-label="Close folders" onClick={() => setDrawer(false)}>{Icon.x}</button>
        </div>
        <ul className="folder-list">
          {rows.map(({ folder: f, depth, hasChildren, expanded }) => (
            <li key={f.path} className="folder-row" style={{ '--depth': depth } as CSSProperties}>
              {hasChildren ? (
                <button
                  type="button"
                  className="folder-toggle"
                  aria-expanded={expanded}
                  aria-label={`${expanded ? 'Hide' : 'Show'} folders inside ${folderLabel(f)}`}
                  onClick={() => setCollapsed((c) => { const n = new Set(c); if (expanded) n.add(f.path); else n.delete(f.path); return n; })}
                >
                  {expanded ? Icon.chevronDown : Icon.chevronRight}
                </button>
              ) : (
                <span className="folder-toggle" aria-hidden="true" />
              )}
              <button
                type="button"
                className={`folder ${f.path === folder ? 'active' : ''} ${f.unseen > 0 ? 'has-unread' : ''} ${dropTarget === f.path ? 'drop' : ''}`}
                aria-current={f.path === folder ? 'true' : undefined}
                disabled={!f.selectable}
                onClick={() => openFolder(f.path)}
                onDragOver={(e) => {
                  if (canDrop(f) && e.dataTransfer.types.includes(DRAG_TYPE)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropTarget(f.path);
                  }
                }}
                onDragLeave={() => setDropTarget((t) => (t === f.path ? null : t))}
                onDrop={(e) => onDrop(e, f)}
              >
                {Icon[folderIcon(f)]}
                <span className="folder-name ellipsis" dir="auto">{folderLabel(f)}</span>
                {f.unseen > 0 && <span className="count" aria-label={`${f.unseen} unread`}>{f.unseen}</span>}
              </button>
              {(!isProtected(f) || f.specialUse === '\\Inbox' || f.path.toUpperCase() === 'INBOX') && (
                <Menu compact align="end" label={`Folder options for ${folderLabel(f)}`} tip="Folder options" icon={Icon.moreVertical} items={folderMenu(f)} />
              )}
            </li>
          ))}
        </ul>
        {quota && (
          <div className="quota" aria-label="Storage">
            {quota.limit ? (
              <>
                <div className="quota-bar" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((quota.used / quota.limit) * 100)}>
                  <span className={quota.used / quota.limit > 0.9 ? 'full' : ''} style={{ width: `${Math.max(1, Math.min(100, (quota.used / quota.limit) * 100))}%` }} />
                </div>
                <span className="muted small">{formatBytes(quota.used)} of {formatBytes(quota.limit)} used{quota.used / quota.limit > 0.9 ? ' - almost full' : ''}</span>
              </>
            ) : (
              <span className="muted small">{formatBytes(quota.used)} used</span>
            )}
          </div>
        )}
      </aside>
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}

      <section className="list" aria-label={`${label} messages`}>
        <div className="pane-head">
          <button type="button" className="icon-btn only-mobile" aria-label="Show folders" onClick={() => setDrawer(true)}>{Icon.menu}</button>
          <form role="search" className="search" onSubmit={runSearch} data-guide="search">
            {Icon.search}
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${label}`} aria-label={`Search ${label}`} maxLength={100} />
            {(search || query) && <button type="button" className="icon-btn" aria-label="Clear search" onClick={clearSearch}>{Icon.x}</button>}
          </form>
          <button type="button" className="icon-btn" aria-label="Refresh" data-tip="Check for new mail" onClick={refresh}>{Icon.refresh}</button>
        </div>

        {checked.size > 0 ? (
          <div className="bulk-bar" role="toolbar" aria-label="Actions for the selected messages">
            <input type="checkbox" className="select-all" checked={allChecked} ref={(el) => { if (el) el.indeterminate = !allChecked; }} onChange={toggleAll} aria-label="Select all messages on this page" />
            <span className="bulk-count">{checked.size} selected</span>
            <span className="grow" />
            {inTrash && <IconAction icon={Icon.restore} label="Restore" onClick={() => restore(selectedIds)} />}
            {inJunk && <IconAction icon={Icon.inbox} label="Not junk: move to Inbox" onClick={() => runBulk(selectedIds, 'notjunk')} />}
            {!inDrafts && (anyUnread
              ? <IconAction icon={Icon.mailOpen} label="Mark as read" onClick={() => runBulk(selectedIds, 'seen')} />
              : <IconAction icon={Icon.mail} label="Mark as unread" onClick={() => runBulk(selectedIds, 'unseen')} />)}
            {!inDrafts && !inTrash && <IconAction icon={Icon.star} label={anyUnstarred ? 'Add star' : 'Remove star'} onClick={() => runBulk(selectedIds, anyUnstarred ? 'flag' : 'unflag')} />}
            {!inArchive && !inTrash && !inDrafts && <IconAction icon={Icon.archive} label="Archive" onClick={() => runBulk(selectedIds, 'archive')} />}
            {!inJunk && !inTrash && !inDrafts && <IconAction icon={Icon.junk} label="Move to Junk" onClick={() => runBulk(selectedIds, 'junk')} />}
            <Menu compact align="end" label="Move to folder" icon={Icon.move} items={moveItems} onPick={(it) => moveTo(selectedIds, it.value)} />
            <IconAction icon={Icon.trash} label={inTrash ? 'Delete for good' : 'Delete'} onClick={() => runBulk(selectedIds, 'delete')} />
            <IconAction icon={Icon.x} label="Clear selection" onClick={() => setChecked(new Set())} />
          </div>
        ) : (
          <div className="list-title">
            {list.items.length > 0 && (
              <input type="checkbox" className="select-all" checked={false} onChange={toggleAll} aria-label="Select all messages on this page" data-tip="Select all on this page" />
            )}
            <h1>{label}</h1>
            <span className="muted small">
              {query ? `${list.total} result${list.total === 1 ? '' : 's'} for “${query}”` : `${list.total} message${list.total === 1 ? '' : 's'}`}
            </span>
          </div>
        )}

        <div className="list-body" aria-busy={loading}>
          {listError && (
            <div className="notice error" role="alert">
              {Icon.alert}<span>{listError}</span>
              <button type="button" className="link" onClick={refresh}>Try again</button>
            </div>
          )}
          {loading && !list.items.length && !listError && <Skeleton />}
          {list.items.length > 0 && (
            <ul className={`msg-list ${checked.size ? 'selecting' : ''}`}>
              {list.items.map((m) => {
                const person = showRecipient && m.to?.address ? m.to : m.from;
                const others = showRecipient && m.toCount && m.toCount > 1 ? ` +${m.toCount - 1}` : '';
                const who = showRecipient ? (m.to?.address ? `To: ${displayName(m.to)}${others}` : '(no recipient)') : displayName(m.from);
                const av = avatarOf(person);
                const isChecked = checked.has(m.id);
                return (
                  <li key={m.id} className={`msg-item ${isChecked ? 'checked' : ''} ${selected === m.id ? 'active' : ''} ${m.seen ? '' : 'unread'}`}>
                    <label className="msg-check">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => undefined}
                        onClick={(e) => toggleCheck(m.id, e)}
                        aria-label={`Select message ${showRecipient ? 'to' : 'from'} ${displayName(person)}: ${m.subject}`}
                      />
                      <span className="avatar" style={{ '--h': av.hue } as CSSProperties} aria-hidden="true">{av.letter}</span>
                    </label>
                    <button
                      type="button"
                      className="msg-row"
                      aria-current={selected === m.id ? 'true' : undefined}
                      draggable
                      onDragStart={(e) => onDragStart(e, m)}
                      onClick={() => openMessage(m)}
                    >
                      <span className="msg-main">
                        <span className="msg-line">
                          <span className="msg-from ellipsis" dir="auto">{who}</span>
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
                    <span className="row-actions-hover">
                      {!inArchive && !inTrash && !inDrafts && <IconAction icon={Icon.archive} label="Archive" onClick={() => runBulk([m.id], 'archive')} />}
                      <IconAction icon={Icon.trash} label={inTrash ? 'Delete for good' : 'Delete'} onClick={() => runBulk([m.id], 'delete')} />
                      {!inDrafts && (m.seen
                        ? <IconAction icon={Icon.mail} label="Mark as unread" onClick={() => runBulk([m.id], 'unseen')} />
                        : <IconAction icon={Icon.mailOpen} label="Mark as read" onClick={() => runBulk([m.id], 'seen')} />)}
                    </span>
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
              <ToolButton icon={Icon.restore} label="Restore" tip="Move this message back to the folder it was deleted from, or to Inbox" disabled={!selected} onClick={() => restore(openIds())} />
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
          {!inArchive && !inTrash && !inDrafts && <ToolButton icon={Icon.archive} label="Archive" tip="Move out of the way to Archive. Find it there any time." disabled={!selected} onClick={() => runBulk(openIds(), 'archive')} />}
          {inJunk
            ? <ToolButton icon={Icon.inbox} label="Not junk" tip="This is not junk: move it to Inbox" disabled={!selected} onClick={() => runBulk(openIds(), 'notjunk')} />
            : !inTrash && !inDrafts && <ToolButton icon={Icon.junk} label="Junk" tip="Move to Junk (unwanted mail)" disabled={!selected} onClick={() => runBulk(openIds(), 'junk')} />}
          <ToolButton icon={Icon.trash} label={inTrash ? 'Delete for good' : 'Delete'} tip={inTrash ? 'Delete for good. This cannot be undone.' : 'Move to Trash. You can restore it later.'} disabled={!selected} onClick={() => runBulk(openIds(), 'delete')} />
          <Menu label="Move" icon={Icon.move} tip="Move to another folder" disabled={!selected} items={moveItems} onPick={(it) => moveTo(openIds(), it.value)} />
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
              <span className="muted small">Tip: tick several messages to act on them together, or drag them onto a folder.</span>
            </div>
          )}
        </div>
      </section>

      {dialog?.mode === 'create' && (
        <FolderDialog
          title={dialog.parent ? `New folder inside ${folderLabel(dialog.parent)}` : 'New folder'}
          hint="Folders help you sort your mail. Drag messages onto a folder to move them."
          confirmLabel="Create folder"
          delimiter={delimiter}
          onSubmit={(name) => createFolder(name, dialog.parent)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.mode === 'rename' && (
        <FolderDialog
          title={`Rename “${folderLabel(dialog.folder)}”`}
          initial={dialog.folder.name}
          confirmLabel="Rename"
          delimiter={delimiter}
          onSubmit={(name) => renameFolder(dialog.folder, name)}
          onClose={() => setDialog(null)}
        />
      )}
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

function IconAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" className="icon-btn" aria-label={label} onClick={onClick}>{icon}</button>;
}

function Skeleton() {
  return (
    <ul className="msg-list" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="msg-item skeleton-row">
          <span className="msg-check"><span className="avatar skeleton" /></span>
          <span className="msg-row">
            <span className="msg-main">
              <span className="skeleton" style={{ width: '45%' }} />
              <span className="skeleton" style={{ width: '80%' }} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
