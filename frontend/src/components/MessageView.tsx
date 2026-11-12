import { useEffect, useState } from 'react';
import { api, MessageFull } from '../api';

// Layer 2 of HTML-email safety (layer 1 = server-side DOMPurify):
// - sandbox="" : no scripts, no forms, no same-origin, unique opaque origin
// - CSP inside srcdoc: no network except data: images, so even a sanitizer bug
//   cannot phone home or load remote content
// Production hardening (layer 3): serve this from a separate origin.
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

function wrap(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<base target="_blank">
<style>body{font:14px/1.5 system-ui,sans-serif;margin:12px;color:#1a1a1a;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#0b57d0}</style>
</head><body>${html}</body></html>`;
}

export default function MessageView(props: {
  id: string;
  onReply: (m: MessageFull) => void;
  onDeleted: () => void;
}) {
  const { id } = props;
  const [msg, setMsg] = useState<MessageFull | null>(null);
  const [err, setErr] = useState('');

  // The parent keys this component by message id, so state starts fresh per message.
  useEffect(() => {
    api.get(id).then(setMsg).catch((e) => setErr(e.message));
  }, [id]);

  if (err) return <div className="pane error">{err}</div>;
  if (!msg) return <div className="pane muted">Loading…</div>;

  const fmt = (a: { name: string; address: string }[]) =>
    a.map((x) => (x.name ? `${x.name} <${x.address}>` : x.address)).join(', ');

  return (
    <div className="pane view">
      <div className="toolbar">
        <button onClick={() => props.onReply(msg)}>Reply</button>
        <button
          onClick={async () => {
            await api.remove(id);
            props.onDeleted();
          }}
        >
          Delete
        </button>
      </div>
      <h2>{msg.subject}</h2>
      <div className="meta">
        <div><b>From:</b> {fmt(msg.from)}</div>
        <div><b>To:</b> {fmt(msg.to)}</div>
        {msg.cc.length > 0 && <div><b>Cc:</b> {fmt(msg.cc)}</div>}
        {msg.date && <div><b>Date:</b> {new Date(msg.date).toLocaleString()}</div>}
      </div>

      {msg.html ? (
        <iframe title="message" className="body" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={wrap(msg.html)} referrerPolicy="no-referrer" />
      ) : (
        <pre className="body text">{msg.text}</pre>
      )}

      {msg.attachments.length > 0 && (
        <div className="attachments">
          {msg.attachments.map((a) => (
            <a key={a.part} href={api.attachmentUrl(id, a.part)} download>
              📎 {a.filename} ({Math.ceil(a.size / 1024)} KB)
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
