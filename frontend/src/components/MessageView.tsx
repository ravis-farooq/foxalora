import type { CSSProperties } from 'react';
import { api, MessageFull } from '../api';
import { avatarOf, displayName, formatAddr, fullDate } from '../mail/format';
import { Icon } from '../ui/icons';

// Layer 2 of HTML-email safety (layer 1 = server-side DOMPurify):
// - sandbox without allow-scripts/allow-same-origin: no scripts, no forms, opaque origin
// - CSP inside srcdoc: no network except data: images, so even a sanitizer bug
//   cannot phone home or load remote content
// Production hardening (layer 3): serve this from a separate origin.
const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

function wrap(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="color-scheme" content="light">
<base target="_blank">
<style>body{font:14px/1.5 system-ui,sans-serif;margin:16px 20px;color:#1a1a1a;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}a{color:#0b57d0}</style>
</head><body>${html}</body></html>`;
}

/** One opened message: header, sandboxed body and attachments. Flags live in the list item. */
export default function MessageView({ msg, flagged, onToggleFlag }: { msg: MessageFull; flagged: boolean; onToggleFlag: () => void }) {
  const sender = msg.from[0];
  const av = avatarOf(sender);
  // Inline images are listed too until the viewer can show cid: images (Phase 2 viewer work).
  const files = msg.attachments;

  return (
    <article className="message-card" aria-labelledby="msg-subject">
      <header className="msg-header">
        <div className="msg-title">
          <h2 id="msg-subject" dir="auto">{msg.subject || '(no subject)'}</h2>
          <button
            type="button"
            className={`icon-btn star ${flagged ? 'on' : ''}`}
            aria-pressed={flagged}
            aria-label={flagged ? 'Remove star' : 'Star this message'}
            title={flagged ? 'Remove star' : 'Star this message'}
            onClick={onToggleFlag}
          >
            {Icon.star}
          </button>
        </div>
        <div className="sender">
          <span className="avatar" style={{ '--h': av.hue } as CSSProperties} aria-hidden="true">{av.letter}</span>
          <div className="sender-text">
            <div>
              <span className="sender-name" dir="auto">{displayName(sender)}</span>
              {sender?.name && <span className="sender-addr"> &lt;{sender.address}&gt;</span>}
            </div>
            <div className="recipients">
              To: {msg.to.map(formatAddr).join(', ') || '(no recipient)'}
              {msg.cc.length > 0 && <> · Cc: {msg.cc.map(formatAddr).join(', ')}</>}
            </div>
          </div>
          {msg.date && <time dateTime={msg.date}>{fullDate(msg.date)}</time>}
        </div>
      </header>

      <div className="msg-content">
        {msg.html ? (
          <iframe title="Message content" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={wrap(msg.html)} referrerPolicy="no-referrer" />
        ) : (
          <pre dir="auto">{msg.text}</pre>
        )}
      </div>

      {files.length > 0 && (
        <footer className="attachments" aria-label="Attachments">
          {files.map((a) => (
            <a key={a.part} className="chip" href={api.attachmentUrl(msg.id, a.part)} download title={`Download ${a.filename}`}>
              {Icon.paperclip}
              <span className="ellipsis">{a.filename}</span>
              <small>{a.size < 1024 ? `${a.size} B` : `${Math.ceil(a.size / 1024)} KB`}</small>
              {Icon.download}
            </a>
          ))}
        </footer>
      )}
    </article>
  );
}
