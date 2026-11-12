import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { EmailComposer } from '../editor/composer/EmailComposer';
import { DEFAULT_TOOLBAR, type ToolbarItem } from '../editor/composer/Toolbar';
import { ImageStore } from '../editor/images';
import type { EmailOutput, QuotedOriginal } from '../editor/serialize';

export interface ComposeInit {
  title?: string;
  to?: string;
  cc?: string;
  subject?: string;
  /** Original message for replies and forwards; kept apart from the typed text. */
  quoted?: QuotedOriginal;
}

const split = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

/** Same custom button as the composer demo (FOX-051). */
const insertDate: ToolbarItem = {
  id: 'insertDate',
  label: 'Insert today’s date',
  icon: <span style={{ fontSize: 12, fontWeight: 600 }}>Date</span>,
  run: ({ editor }) => editor.chain().focus().insertContent(new Date().toLocaleDateString('en-GB', { dateStyle: 'long' })).run(),
};
const TOOLBAR = [...DEFAULT_TOOLBAR, '|', insertDate];

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export default function Compose({ init, onClose }: { init: ComposeInit; onClose: () => void }) {
  const [to, setTo] = useState(init.to ?? '');
  const [cc, setCc] = useState(init.cc ?? '');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(!!init.cc);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(init.subject ?? '');
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const images = useMemo(() => new ImageStore(), []);
  const typed = useRef(false);

  const dirty = () =>
    typed.current || to !== (init.to ?? '') || cc !== (init.cc ?? '') || bcc !== '' || subject !== (init.subject ?? '');

  // COMP-016: warn before leaving the page with an unsent message.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!dirty()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  });

  const close = () => {
    if (dirty() && !window.confirm('Discard this message?')) return;
    onClose();
  };

  async function send(out: EmailOutput) {
    setErr('');
    const recipients = split(to);
    if (!recipients.length) {
      setErr('Add at least one recipient.');
      return;
    }
    setSending(true);
    try {
      const inlineImages = await Promise.all(
        out.contentIds.map(async (contentId) => {
          const img = images.get(contentId)!;
          return { contentId, filename: img.name, contentType: img.blob.type, data: await blobToBase64(img.blob) };
        }),
      );
      await api.send({ to: recipients, cc: split(cc), bcc: split(bcc), subject, text: out.text, html: out.html, inlineImages });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <section className="compose-window" role="dialog" aria-modal="true" aria-labelledby="compose-title">
        <header className="compose-head">
          <h3 id="compose-title">{init.title ?? 'New message'}</h3>
          <button type="button" className="ghost icon" aria-label="Close" title="Close" onClick={close}>✕</button>
        </header>

        <div className="compose-fields">
          <label className="compose-line">
            <span>To</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} autoFocus={!init.to} inputMode="email" />
            {!showCc && <button type="button" className="link" onClick={() => setShowCc(true)}>Cc</button>}
            {!showBcc && <button type="button" className="link" onClick={() => setShowBcc(true)}>Bcc</button>}
          </label>
          {showCc && (
            <label className="compose-line">
              <span>Cc</span>
              <input value={cc} onChange={(e) => setCc(e.target.value)} inputMode="email" />
            </label>
          )}
          {showBcc && (
            <label className="compose-line">
              <span>Bcc</span>
              <input value={bcc} onChange={(e) => setBcc(e.target.value)} inputMode="email" />
            </label>
          )}
          <label className="compose-line">
            <span className="sr-only">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
          </label>
        </div>

        {err && <div className="error compose-error" role="alert">{err}</div>}

        <EmailComposer
          quoted={init.quoted}
          images={images}
          toolbar={TOOLBAR}
          sending={sending}
          // Typed content only: the quoted original is not part of the editor document.
          onChange={(_out, json) => { typed.current = JSON.stringify(json).includes('"text"') || JSON.stringify(json).includes('"image"'); }}
          onSend={send}
          onDiscard={close}
        />
      </section>
    </div>
  );
}
