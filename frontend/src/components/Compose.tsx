import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { EmailComposer, type Signature } from '../editor/composer/EmailComposer';
import { DEFAULT_TOOLBAR, type ToolbarItem } from '../editor/composer/Toolbar';
import { ImageStore } from '../editor/images';
import type { EmailOutput, QuotedOriginal } from '../editor/serialize';
import { withInlineSignatureImages } from '../editor/signature-images';
import { useConfirm } from '../ui/confirm-context';
import { Icon } from '../ui/icons';
import { useToast } from '../ui/toast-context';
import RecipientInput from './RecipientInput';

export interface ComposeInit {
  title?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  /** Original message for replies and forwards; kept apart from the typed text. */
  quoted?: QuotedOriginal;
  /** Short notice shown above the editor (for example, attachments that are not forwarded). */
  note?: string;
  /** A saved draft being continued: its id (replaced on save, removed on send) and its body. */
  draftId?: string;
  initialHtml?: string;
}

const split = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const AUTOSAVE_MS = 30_000;

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

/**
 * Compose window. Closing it never loses work (FOX-055): unsent changes are saved to the
 * Drafts folder, also every 30 seconds while writing. Only Discard throws a message away,
 * after a confirmation.
 */
export default function Compose({ init, onClose, onSent, onDraftSaved, signatures, defaultSignatureId }: {
  init: ComposeInit;
  onClose: () => void;
  onSent?: (sentCopy?: 'saved' | 'server' | 'no_folder' | 'failed') => void;
  onDraftSaved?: () => void;
  signatures?: Record<string, Signature>;
  defaultSignatureId?: string;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [to, setTo] = useState(init.to ?? '');
  const [cc, setCc] = useState(init.cc ?? '');
  const [bcc, setBcc] = useState(init.bcc ?? '');
  const [showCc, setShowCc] = useState(!!init.cc);
  const [showBcc, setShowBcc] = useState(!!init.bcc);
  const [subject, setSubject] = useState(init.subject ?? '');
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<'' | 'saving' | 'saved' | 'failed'>(init.draftId ? 'saved' : '');
  const images = useMemo(() => new ImageStore(), []);
  // Signature images travel as inline attachments of this message.
  const composerSignatures = useMemo(() => withInlineSignatureImages(signatures ?? {}, images), [signatures, images]);
  const output = useRef<EmailOutput | null>(null);
  const draftId = useRef(init.draftId);
  // What is already safe (saved, or untouched since opening). Until the user first types,
  // the baseline follows the editor, which reports its start-up content (signature included).
  const baseline = useRef<string | null>(null);
  const interacted = useRef(false);
  const saving = useRef<Promise<void> | null>(null);

  const snapshot = () => JSON.stringify([to, cc, bcc, subject, output.current?.html ?? '']);
  const dirty = () => baseline.current !== null && snapshot() !== baseline.current;

  async function inlineImages(out: EmailOutput) {
    return Promise.all(
      out.contentIds.map(async (contentId) => {
        const img = images.get(contentId)!;
        return { contentId, filename: img.name, contentType: img.blob.type, data: await blobToBase64(img.blob) };
      }),
    );
  }

  async function saveDraft(): Promise<void> {
    if (saving.current) await saving.current; // one save at a time
    if (!dirty()) return;
    const out = output.current;
    const snap = snapshot();
    setStatus('saving');
    const run = (async () => {
      try {
        const res = await api.saveDraft({
          to: split(to), cc: split(cc), bcc: split(bcc), subject,
          text: out?.text ?? '', html: out?.html, inlineImages: out ? await inlineImages(out) : [],
          replaceId: draftId.current,
        });
        draftId.current = res.id;
        baseline.current = snap;
        setStatus('saved');
        onDraftSaved?.();
      } catch (e) {
        setStatus('failed');
        throw e;
      } finally {
        saving.current = null;
      }
    })();
    saving.current = run;
    return run;
  }

  // Latest saveDraft for the timer and the page-leave warning.
  const saveRef = useRef(saveDraft);
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    saveRef.current = saveDraft;
    dirtyRef.current = dirty;
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (dirtyRef.current()) saveRef.current().catch(() => undefined); // status shows the failure
    }, AUTOSAVE_MS);
    // COMP-016: the browser cannot wait for a save while the page closes, so warn instead.
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  /** Close = keep: unsaved changes go to Drafts first. */
  async function close() {
    if (sending) return;
    if (!dirty()) {
      onClose();
      return;
    }
    try {
      await saveDraft();
      toast('success', 'Saved to Drafts. Open the Drafts folder to finish it later.');
      onClose();
    } catch (e) {
      const leave = await confirm({
        title: 'The draft could not be saved',
        message: `${(e as Error).message} If you close now, this message is lost.`,
        confirmLabel: 'Close without saving',
        cancelLabel: 'Keep writing',
        danger: true,
      });
      if (leave) onClose();
    }
  }

  async function discard() {
    if (!dirty() && !draftId.current) {
      onClose();
      return;
    }
    const ok = await confirm({
      title: 'Discard this message?',
      message: draftId.current ? 'The saved draft is deleted too. This cannot be undone.' : 'What you have written will be lost. This cannot be undone.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep writing',
      danger: true,
    });
    if (!ok) return;
    if (draftId.current) await api.deleteDraft(draftId.current).catch(() => undefined);
    toast('info', 'Message discarded.');
    onClose();
  }

  async function send(out: EmailOutput) {
    setErr('');
    const recipients = split(to);
    if (!recipients.length) {
      setErr('Add at least one recipient in the To field.');
      return;
    }
    setSending(true);
    try {
      if (saving.current) await saving.current.catch(() => undefined);
      const res = await api.send({ to: recipients, cc: split(cc), bcc: split(bcc), subject, text: out.text, html: out.html, inlineImages: await inlineImages(out), draftId: draftId.current });
      onSent?.(res.sentCopy);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const statusText = { '': '', saving: 'Saving…', saved: 'Saved to Drafts', failed: 'Not saved' }[status];
  const markInteracted = () => {
    interacted.current = true;
  };

  return (
    <div className="modal" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <section
        className="compose-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-title"
        onKeyDownCapture={markInteracted}
        onPasteCapture={markInteracted}
        onDropCapture={markInteracted}
      >
        <header className="compose-head">
          <h3 id="compose-title">{init.title ?? 'New message'}</h3>
          <span className={`draft-status ${status}`} aria-live="polite">{statusText}</span>
          <button type="button" className="ghost icon" aria-label="Close (your message is saved to Drafts)" data-tip="Close. Your message is kept in Drafts." onClick={close}>{Icon.x}</button>
        </header>

        <div className="compose-fields">
          <label className="compose-line">
            <span>To</span>
            <RecipientInput label="To" value={to} onChange={setTo} autoFocus={!init.to} />
            {!showCc && <button type="button" className="link" data-tip="Add people who should get a copy" onClick={() => setShowCc(true)}>Cc</button>}
            {!showBcc && <button type="button" className="link" data-tip="Add people who get a hidden copy" onClick={() => setShowBcc(true)}>Bcc</button>}
          </label>
          {showCc && (
            <label className="compose-line">
              <span>Cc</span>
              <RecipientInput label="Cc" value={cc} onChange={setCc} />
            </label>
          )}
          {showBcc && (
            <label className="compose-line">
              <span>Bcc</span>
              <RecipientInput label="Bcc" value={bcc} onChange={setBcc} />
            </label>
          )}
          <label className="compose-line">
            <span className="sr-only">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" maxLength={998} />
          </label>
        </div>

        {init.note && <p className="compose-note">{Icon.info}<span>{init.note}</span></p>}
        {err && <div className="error compose-error" role="alert">{err}</div>}

        <EmailComposer
          initialContent={init.initialHtml}
          quoted={init.quoted}
          images={images}
          toolbar={TOOLBAR}
          signatures={composerSignatures}
          // A continued draft already contains its signature.
          defaultSignatureId={init.initialHtml === undefined ? defaultSignatureId : undefined}
          sending={sending}
          onChange={(out) => {
            output.current = out;
            if (!interacted.current) baseline.current = JSON.stringify([to, cc, bcc, subject, out.html]);
          }}
          onSend={send}
          onDiscard={discard}
        />
      </section>
    </div>
  );
}
