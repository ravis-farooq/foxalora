import { useCallback, useEffect, useState } from 'react';
import { api, Folder, MessageFull, MessageSummary } from '../api';
import Compose, { ComposeInit } from './Compose';
import MessageView from './MessageView';

export default function Mailbox({ email, onLogout }: { email: string; onLogout: () => void }) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState('INBOX');
  const [items, setItems] = useState<MessageSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const [error, setError] = useState('');

  const loadFolders = useCallback(() => api.folders().then(setFolders).catch((e) => setError(e.message)), []);

  const loadPage = useCallback(
    async (f: string, p: number, replace: boolean) => {
      try {
        const r = await api.list(f, p);
        setTotal(r.total);
        setItems((prev) => (replace ? r.items : [...prev, ...r.items]));
      } catch (e: any) {
        setError(e.message);
      }
    },
    [],
  );

  useEffect(() => { loadFolders(); }, [loadFolders]);
  useEffect(() => {
    api.list('INBOX', 1).then((r) => { setTotal(r.total); setItems(r.items); }).catch((e) => setError(e.message));
  }, []);

  function openFolder(f: string) {
    setFolder(f); setItems([]); setPage(1); setSelected(null);
    loadPage(f, 1, true);
  }

  function reply(m: MessageFull) {
    const from = m.from[0];
    const who = from ? (from.name ? `${from.name} <${from.address}>` : from.address) : '';
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    setCompose({
      title: 'Reply',
      to: from?.address ?? '',
      subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
      quoted: {
        header: `On ${m.date ? new Date(m.date).toLocaleString() : ''}, ${who} wrote:`,
        // m.html was sanitized by the server; plain-text messages are escaped here.
        html: m.html ?? esc(m.text).replace(/\n/g, '<br>'),
        text: m.text,
      },
    });
  }

  return (
    <div className="app">
      <header>
        <strong>Foxalora Mail</strong>
        <span className="grow" />
        <span className="muted small">{email}</span>
        <button className="ghost" onClick={onLogout}>Sign out</button>
      </header>

      <div className="layout">
        <nav className="folders">
          <button className="primary" onClick={() => setCompose({})}>Compose</button>
          {folders.map((f) => (
            <button key={f.path} className={f.path === folder ? 'folder active' : 'folder'} onClick={() => openFolder(f.path)}>
              <span>{f.name}</span>
              {f.unseen > 0 && <span className="badge">{f.unseen}</span>}
            </button>
          ))}
        </nav>

        <section className="list">
          {error && <div className="error">{error}</div>}
          {items.map((m) => (
            <button
              key={m.id}
              className={`row-item ${m.seen ? '' : 'unread'} ${selected === m.id ? 'active' : ''}`}
              onClick={() => {
                setSelected(m.id);
                setItems((p) => p.map((x) => (x.id === m.id ? { ...x, seen: true } : x)));
              }}
            >
              <div className="from">{m.from.name || m.from.address} {m.hasAttachment && '📎'}</div>
              <div className="subject">{m.subject}</div>
              <div className="muted small">{m.date ? new Date(m.date).toLocaleString() : ''}</div>
            </button>
          ))}
          {items.length < total && (
            <button className="ghost" onClick={() => { const n = page + 1; setPage(n); loadPage(folder, n, false); }}>
              Load more
            </button>
          )}
          {!items.length && !error && <div className="muted pad">No messages</div>}
        </section>

        <section className="reader">
          {selected ? (
            <MessageView
              key={selected}
              id={selected}
              onReply={reply}
              onDeleted={() => { setItems((p) => p.filter((x) => x.id !== selected)); setSelected(null); loadFolders(); }}
            />
          ) : (
            <div className="pane muted">Select a message</div>
          )}
        </section>
      </div>

      {compose && <Compose init={compose} onClose={() => setCompose(null)} />}
    </div>
  );
}
