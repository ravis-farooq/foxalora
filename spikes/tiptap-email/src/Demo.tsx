import type { Editor, JSONContent } from '@tiptap/core';
import { useEffect, useMemo, useState } from 'react';
import { EmailComposer, type Signature } from './composer/EmailComposer';
import { DEFAULT_TOOLBAR, type ToolbarItem } from './composer/Toolbar';
import { ImageStore } from './images';
import type { EmailOutput, QuotedOriginal } from './serialize';
import excelSample from './samples/excel.html?raw';
import gdocsSample from './samples/gdocs.html?raw';
import hostileSample from './samples/hostile.html?raw';
import wordSample from './samples/word.html?raw';

const para = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const SIGNATURES: Record<string, Signature> = {
  'sig-en': { label: 'Sam Lee (English)', content: { type: 'doc', content: [para('Sam Lee'), para('Support, Example Hosting')] } },
  'sig-ar': { label: 'سام لي (العربية)', content: { type: 'doc', content: [para('سام لي'), para('الدعم الفني، شركة الاستضافة')] } },
};
const QUOTED: QuotedOriginal = {
  header: 'On Wed, 11 Nov 2026, Alice <alice@example.com> wrote:',
  html: '<div>Can you send the Q3 numbers before Friday?</div>',
  text: 'Can you send the Q3 numbers before Friday?',
};

/** Extensibility example: a custom toolbar button supplied by the host page. */
const insertDate: ToolbarItem = {
  id: 'insertDate',
  label: 'Insert today’s date',
  icon: <span style={{ fontSize: 12, fontWeight: 600 }}>Date</span>,
  run: ({ editor }) => editor.chain().focus().insertContent(new Date().toLocaleDateString('en-GB', { dateStyle: 'long' })).run(),
};

export default function Demo() {
  const images = useMemo(() => new ImageStore(), []);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [out, setOut] = useState<EmailOutput | null>(null);
  const [reply, setReply] = useState(true);
  const [tab, setTab] = useState<'preview' | 'html' | 'text'>('preview');
  const [sent, setSent] = useState('');
  const [dataUrls, setDataUrls] = useState<Record<string, string>>({});

  // The sandboxed preview has an opaque origin and cannot load blob: URLs; use data: URLs there.
  const ids = out?.contentIds.join(',') ?? '';
  useEffect(() => {
    for (const id of ids ? ids.split(',') : []) {
      const img = images.get(id);
      if (!img || dataUrls[id]) continue;
      const reader = new FileReader();
      reader.onload = () => setDataUrls((m) => ({ ...m, [id]: String(reader.result) }));
      reader.readAsDataURL(img.blob);
    }
  }, [ids, dataUrls, images]);

  useEffect(() => {
    if (import.meta.env.DEV && editor) (window as any).fxEditor = editor; // spike debugging only
  }, [editor]);

  const previewDoc = (out?.html ?? '')
    .replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`)
    .replace(/src="cid:([^"]+)"/g, (_, id) => `src="${dataUrls[id] ?? ''}"`);

  const pasteSample = (html: string) => {
    if (!editor) return;
    editor.commands.focus('start');
    editor.view.pasteHTML(html);
  };

  return (
    <div className="demo">
      <h1>Foxalora composer (spike FOX-051)</h1>
      <p className="demo-note">Gmail-style formatting bar, bubble menus on selected text, links, images and tables, and a "+" menu on empty lines. Select text, click a link, or click inside a table to see the menus.</p>

      <EmailComposer
        key={reply ? 'reply' : 'new'}
        initialContent="<p>Hello Alice,</p><p></p><p>Here are the numbers you asked for.</p><p></p>"
        signatures={SIGNATURES}
        defaultSignatureId="sig-en"
        quoted={reply ? QUOTED : undefined}
        images={images}
        toolbar={[...DEFAULT_TOOLBAR, '|', insertDate]}
        onReady={setEditor}
        onChange={(o) => setOut(o)}
        onSend={(o) => setSent(`Would send ${o.html.length} characters of HTML, ${o.text.length} of plain text and ${o.contentIds.length} inline image(s).`)}
        onDiscard={() => editor?.commands.clearContent(true)}
      />
      {sent && <p className="demo-status" role="status">{sent}</p>}

      <div className="demo-row">
        <label><input type="checkbox" checked={reply} onChange={(e) => setReply(e.target.checked)} /> Reply (adds quoted original)</label>
        <button type="button" onClick={() => pasteSample(wordSample)}>Paste Word sample</button>
        <button type="button" onClick={() => pasteSample(gdocsSample)}>Paste Google Docs sample</button>
        <button type="button" onClick={() => pasteSample(excelSample)}>Paste Excel sample</button>
        <button type="button" onClick={() => pasteSample(hostileSample)}>Paste hostile sample</button>
      </div>

      <div className="demo-row" role="tablist" aria-label="Output">
        {(['preview', 'html', 'text'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'preview' ? 'Email preview' : t === 'html' ? 'HTML sent' : 'Plain text sent'}
          </button>
        ))}
        <span className="demo-meta">{out?.contentIds.length ?? 0} inline image attachment(s)</span>
      </div>
      {tab === 'preview' && <iframe title="Email preview" sandbox="" srcDoc={previewDoc} className="demo-preview" />}
      {tab === 'html' && <pre className="demo-code" data-testid="html-out">{out?.html}</pre>}
      {tab === 'text' && <pre className="demo-code" data-testid="text-out">{out?.text}</pre>}
    </div>
  );
}
