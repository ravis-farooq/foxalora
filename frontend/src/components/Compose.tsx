import { FormEvent, useState } from 'react';
import { api } from '../api';

export interface ComposeInit { to?: string; subject?: string; body?: string }

const split = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

export default function Compose({ init, onClose }: { init: ComposeInit; onClose: () => void }) {
  const [to, setTo] = useState(init.to ?? '');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState(init.subject ?? '');
  const [text, setText] = useState(init.body ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api.send({ to: split(to), cc: split(cc), subject, text });
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal">
      <form className="card compose" onSubmit={submit}>
        <h3>New message</h3>
        <input placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} required />
        <input placeholder="Cc" value={cc} onChange={(e) => setCc(e.target.value)} />
        <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
        {err && <div className="error">{err}</div>}
        <div className="row">
          <button disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
          <button type="button" className="ghost" onClick={onClose}>Discard</button>
        </div>
      </form>
    </div>
  );
}
