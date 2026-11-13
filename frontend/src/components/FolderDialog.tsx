import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../ui/icons';

/** Asks for a folder name (new folder or rename). The server checks the name again. */
export default function FolderDialog({ title, hint, initial = '', confirmLabel, delimiter, onSubmit, onClose }: {
  title: string;
  hint?: string;
  initial?: string;
  confirmLabel: string;
  delimiter: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setErr('Give the folder a name.');
    if (/[*%"\\/]/.test(n) || (delimiter && n.includes(delimiter))) {
      return setErr(`Folder names cannot contain ${delimiter && delimiter !== '/' ? `"${delimiter}", ` : ''}/, *, %, " or \\.`);
    }
    setBusy(true);
    setErr('');
    try {
      await onSubmit(n);
    } catch (ex) {
      setErr((ex as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal" onKeyDown={(e) => e.key === 'Escape' && onClose()} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog folder-dialog" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" onSubmit={submit}>
        <button type="button" className="icon-btn dialog-close" aria-label="Close" onClick={onClose}>{Icon.x}</button>
        <h2 id="folder-dialog-title" className="dialog-title">{title}</h2>
        {hint && <p className="muted small">{hint}</p>}
        <label className="field">
          Folder name
          <input ref={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} dir="auto" placeholder="For example: Work" />
        </label>
        {err && <div className="notice error" role="alert">{Icon.alert}<span>{err}</span></div>}
        <div className="form-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
