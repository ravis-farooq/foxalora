import type { JSONContent } from '@tiptap/core';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api, type Preferences, type SignatureRecord } from '../api';
import { serializeEmail } from '../editor/serialize';
import { Icon } from '../ui/icons';
import { usePrefs } from '../ui/prefs-context';
import { useConfirm } from '../ui/confirm-context';
import { useToast } from '../ui/toast-context';
import { countImages } from '../editor/signature-images';
import SignatureEditor from './SignatureEditor';

type Section = 'general' | 'appearance' | 'signatures';

const SECTIONS: { id: Section; label: string; hint: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', hint: 'Your name and time zone', icon: Icon.user },
  { id: 'appearance', label: 'Appearance', hint: 'Theme and list density', icon: Icon.palette },
  { id: 'signatures', label: 'Signatures', hint: 'Added to the messages you write', icon: Icon.pen },
];

// Intl.supportedValuesOf is newer than the TypeScript lib this project targets.
const TIME_ZONES: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function Settings({ email, signatures, onSignaturesChanged, onAbout, onGuide }: {
  email: string;
  signatures: SignatureRecord[];
  onSignaturesChanged: () => void;
  onAbout: () => void;
  onGuide: () => void;
}) {
  const [section, setSection] = useState<Section>('general');
  const [open, setOpen] = useState(false); // phones: section list or section content

  return (
    <main id="main" tabIndex={-1} className={`settings-view ${open ? 'has-detail' : ''}`}>
      <nav className="list settings-nav" aria-label="Settings sections">
        <div className="pane-head"><h1 className="pane-title">Settings</h1></div>
        <ul className="section-list">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button type="button" className={`section-btn ${section === s.id ? 'active' : ''}`} aria-current={section === s.id ? 'page' : undefined} onClick={() => { setSection(s.id); setOpen(true); }}>
                {s.icon}
                <span><strong>{s.label}</strong><small>{s.hint}</small></span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="link about-link" onClick={onAbout}>{Icon.info} About Foxalora Mail</button>
      </nav>
      <section className="reader settings-body" aria-labelledby="settings-title">
        <div className="pane-head toolbar">
          <button type="button" className="icon-btn only-mobile" aria-label="Back to settings" onClick={() => setOpen(false)}>{Icon.back}</button>
          <h2 id="settings-title" className="pane-title">{SECTIONS.find((s) => s.id === section)!.label}</h2>
        </div>
        <div className="reader-body">
          <div className="settings-content">
            {section === 'general' && <General email={email} onGuide={onGuide} />}
            {section === 'appearance' && <Appearance />}
            {section === 'signatures' && <Signatures signatures={signatures} onChanged={onSignaturesChanged} />}
          </div>
        </div>
      </section>
    </main>
  );
}

/** Saves a preference and reports the outcome. */
function useSave() {
  const { save } = usePrefs();
  const toast = useToast();
  return async (change: Partial<Preferences>, done = 'Saved.') => {
    try {
      await save(change);
      toast('success', done);
      return true;
    } catch (e) {
      toast('error', (e as Error).message);
      return false;
    }
  };
}

function General({ email, onGuide }: { email: string; onGuide: () => void }) {
  const { prefs, reset } = usePrefs();
  const toast = useToast();
  const confirm = useConfirm();
  const save = useSave();
  const [name, setName] = useState(prefs.displayName);
  const [nameErr, setNameErr] = useState('');
  const [synced, setSynced] = useState(prefs.displayName);
  // Preferences can arrive after this section opened (first load) or be reset.
  if (prefs.displayName !== synced) {
    setSynced(prefs.displayName);
    setName(prefs.displayName);
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (/[<>"]/.test(name)) {
      setNameErr('Leave out < > and " so the name cannot look like another address.');
      return;
    }
    setNameErr('');
    await save({ displayName: name.trim() }, 'Display name saved.');
  }

  return (
    <>
      <form className="setting-card" onSubmit={saveName}>
        <h3>Display name</h3>
        <p className="muted small">Shown to people you write to, next to your address.</p>
        <div className="inline-field">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-label="Display name" placeholder="Your name" dir="auto" />
          <button className="primary" disabled={name.trim() === prefs.displayName}>Save</button>
        </div>
        {nameErr && <div className="notice error" role="alert">{Icon.alert}<span>{nameErr}</span></div>}
        <p className="preview-line">
          <span className="muted small">Recipients see:</span> <strong dir="auto">{name.trim() ? `${name.trim()} <${email}>` : email}</strong>
        </p>
      </form>

      <div className="setting-card">
        <h3><label htmlFor="tz">Time zone</label></h3>
        <p className="muted small">Used for the dates and times shown in your mail.</p>
        <select id="tz" value={prefs.timeZone} onChange={(e) => save({ timeZone: e.target.value }, 'Time zone saved.')}>
          <option value="auto">Automatic (this device: {BROWSER_TZ})</option>
          {TIME_ZONES.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      <div className="setting-card">
        <h3>Address suggestions</h3>
        <p className="muted small">While you type a recipient, Foxalora suggests your contacts and the addresses you have written to before. Only the address is kept, never the message.</p>
        <label className="checkbox">
          <input type="checkbox" checked={prefs.rememberRecipients} onChange={(e) => save({ rememberRecipients: e.target.checked }, e.target.checked ? 'Addresses you write to will be suggested.' : 'New addresses will not be remembered.')} />
          Remember the addresses I write to
        </label>
        <button
          type="button"
          className="ghost"
          onClick={async () => {
            if (!(await confirm({ title: 'Clear the address history?', message: 'Addresses you have written to are no longer suggested. Your contacts are kept.', confirmLabel: 'Clear history', danger: true }))) return;
            try {
              await api.clearRecent();
              toast('success', 'Address history cleared.');
            } catch (e) {
              toast('error', (e as Error).message);
            }
          }}
        >
          Clear address history
        </button>
      </div>

      <div className="setting-card">
        <h3>Getting started</h3>
        <p className="muted small">A short tour of the main parts of Foxalora Mail.</p>
        <button type="button" className="ghost" onClick={onGuide}>Show the welcome guide again</button>
      </div>

      <div className="setting-card">
        <h3>Reset settings</h3>
        <p className="muted small">Puts name, time zone, theme and density back to the defaults. Signatures and contacts are kept.</p>
        <button
          type="button"
          className="ghost danger-text"
          onClick={async () => {
            if (!(await confirm({ title: 'Reset your settings?', message: 'Name, time zone, theme, density and suggestion settings go back to the defaults. Contacts and signatures are kept.', confirmLabel: 'Reset settings', danger: true }))) return;
            try {
              await reset();
              toast('success', 'Settings reset.');
            } catch (e) {
              toast('error', (e as Error).message);
            }
          }}
        >
          Reset to defaults
        </button>
      </div>
    </>
  );
}

function Choice<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: { value: T; label: string; hint: string; preview?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="choices" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <label key={o.value} className={`choice ${value === o.value ? 'checked' : ''}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.preview}
          <strong>{o.label}</strong>
          <small className="muted">{o.hint}</small>
        </label>
      ))}
    </div>
  );
}

function Appearance() {
  const { prefs } = usePrefs();
  const save = useSave();
  return (
    <>
      <div className="setting-card">
        <h3>Theme</h3>
        <Choice
          name="Theme"
          value={prefs.theme}
          onChange={(theme) => save({ theme }, 'Theme saved.')}
          options={[
            { value: 'system', label: 'System', hint: 'Follows your device', preview: <span className="swatch system" aria-hidden="true" /> },
            { value: 'light', label: 'Light', hint: 'Light background', preview: <span className="swatch light" aria-hidden="true" /> },
            { value: 'dark', label: 'Dark', hint: 'Dark background', preview: <span className="swatch dark" aria-hidden="true" /> },
          ]}
        />
      </div>
      <div className="setting-card">
        <h3>Message list density</h3>
        <Choice
          name="Density"
          value={prefs.density}
          onChange={(density) => save({ density }, 'Density saved.')}
          options={[
            { value: 'comfortable', label: 'Comfortable', hint: 'Sender pictures and more space' },
            { value: 'compact', label: 'Compact', hint: 'More messages on screen' },
          ]}
        />
      </div>
    </>
  );
}

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
const previewText = (doc: JSONContent) => serializeEmail(doc).text.trim();

function Signatures({ signatures, onChanged }: { signatures: SignatureRecord[]; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<(Omit<SignatureRecord, 'id'> & { id?: string }) | null>(null);

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      toast('success', done);
      onChanged();
      return true;
    } catch (e) {
      toast('error', (e as Error).message);
      return false;
    }
  }

  if (editing) return <SignatureForm initial={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />;

  return (
    <div className="setting-card">
      <div className="card-head">
        <div>
          <h3>Your signatures</h3>
          <p className="muted small">The default signature is added to new messages, replies and forwards. You can switch or remove it while writing.</p>
        </div>
        <button type="button" className="primary with-icon" onClick={() => setEditing({ name: signatures.length ? '' : 'Default', content: EMPTY_DOC, isDefault: !signatures.length })}>
          {Icon.plus} New signature
        </button>
      </div>
      {signatures.length === 0 ? (
        <div className="empty small-empty">{Icon.pen}<strong>No signatures yet</strong></div>
      ) : (
        <ul className="signature-list">
          {signatures.map((s) => (
            <li key={s.id} className="signature-item">
              <div className="signature-text">
                <strong>{s.name}</strong>
                {s.isDefault && <span className="badge-soft">Default</span>}
                <p className="muted small signature-preview">{previewText(s.content) || (countImages(s.content) ? '' : '(empty)')}</p>
                {countImages(s.content) > 0 && <p className="muted small">{Icon.paperclip} {countImages(s.content)} image{countImages(s.content) === 1 ? '' : 's'}</p>}
              </div>
              <div className="row-actions">
                {!s.isDefault && <button type="button" className="link" onClick={() => run(() => api.updateSignature(s.id, { name: s.name, content: s.content, isDefault: true }), `“${s.name}” is now the default.`)}>Make default</button>}
                <button type="button" className="link" onClick={() => setEditing(s)}>Edit</button>
                <button
                  type="button"
                  className="link danger-text"
                  onClick={async () => (await confirm({ title: `Delete the signature “${s.name}”?`, message: 'Messages you already sent are not changed.', confirmLabel: 'Delete signature', danger: true })) && run(() => api.deleteSignature(s.id), 'Signature deleted.')}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SignatureForm({ initial, onCancel, onSaved }: { initial: Omit<SignatureRecord, 'id'> & { id?: string }; onCancel: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(initial.name);
  const [isDefault, setIsDefault] = useState(initial.isDefault);
  const [content, setContent] = useState<JSONContent>(initial.content);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const start = useMemo(() => initial.content, [initial.content]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErr('Give the signature a name.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const body = { name: name.trim(), content, isDefault };
      if (initial.id) await api.updateSignature(initial.id, body);
      else await api.createSignature(body);
      toast('success', 'Signature saved.');
      onSaved();
    } catch (ex) {
      setErr((ex as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="setting-card" onSubmit={submit}>
      <h3>{initial.id ? 'Edit signature' : 'New signature'}</h3>
      <label className="field">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="For example: Work" autoFocus />
      </label>
      <div className="field">
        <span id="sig-label">Signature</span>
        <SignatureEditor initial={start} onChange={setContent} />
        <small className="muted">Text, formatting, links and up to 3 images such as your logo (PNG, JPEG or GIF, 64 KB each). Images are sent with each message, so they show without loading anything from the internet.</small>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
        Add this signature to new messages
      </label>
      {err && <div className="notice error" role="alert">{Icon.alert}<span>{err}</span></div>}
      <div className="form-actions">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save signature'}</button>
      </div>
    </form>
  );
}
