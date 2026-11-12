import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useState } from 'react';
import { LinkDialog } from '../editor/composer/LinkDialog';
import { BUILTIN_ITEMS, Toolbar, type ToolbarContext, type ToolbarEntry } from '../editor/composer/Toolbar';
import { emailExtensions } from '../editor/extensions';
import { cleanPastedHtml } from '../editor/paste';
import '../editor/composer/composer.css';

// Signatures hold text, formatting and links. Images are left out until they can be stored (no remote images in mail).
const ENTRIES: ToolbarEntry[] = ['undo', 'redo', '|', 'font', 'size', '|', 'bold', 'italic', 'underline', 'color', '|', 'link', '|', 'align', '|', 'bulletList', 'clear'];

/** The composer's editor (same schema and output), with a shorter toolbar, for editing a signature. */
export default function SignatureEditor({ initial, onChange }: { initial: JSONContent; onChange: (doc: JSONContent) => void }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const editor = useEditor({
    extensions: emailExtensions({ placeholder: 'Your name, role, phone number…', onLinkShortcut: () => setLinkOpen(true) }),
    content: initial,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { 'aria-label': 'Signature', 'aria-multiline': 'true', class: 'fx-body' },
      transformPastedHTML: (html) => cleanPastedHtml(html),
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON()),
  });
  if (!editor) return null;
  const ctx: ToolbarContext = { editor, openLink: () => setLinkOpen(true) };

  return (
    <div className="fx-composer signature-editor">
      <Toolbar entries={ENTRIES} items={BUILTIN_ITEMS} ctx={ctx} label="Signature formatting" />
      <div className="fx-editor-wrap">
        <EditorContent editor={editor} />
        {linkOpen && <LinkDialog editor={editor} onClose={() => setLinkOpen(false)} />}
      </div>
    </div>
  );
}
