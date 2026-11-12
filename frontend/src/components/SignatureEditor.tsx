import type { JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Icon as EditorIcon } from '../editor/composer/icons';
import { LinkDialog } from '../editor/composer/LinkDialog';
import { BUILTIN_ITEMS, Toolbar, type ToolbarContext, type ToolbarEntry, type ToolbarItem } from '../editor/composer/Toolbar';
import { emailExtensions } from '../editor/extensions';
import { cleanPastedHtml } from '../editor/paste';
import { countImages, MAX_SIGNATURE_IMAGE_BYTES, MAX_SIGNATURE_IMAGES, SIGNATURE_IMAGE_TYPES } from '../editor/signature-images';
import { Icon } from '../ui/icons';
import '../editor/composer/composer.css';

const ENTRIES: ToolbarEntry[] = ['undo', 'redo', '|', 'font', 'size', '|', 'bold', 'italic', 'underline', 'color', '|', 'link', 'signatureImage', '|', 'align', '|', 'bulletList', 'clear'];
const kb = (n: number) => `${Math.ceil(n / 1024)} KB`;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * The composer's editor (same schema and output), with a shorter toolbar, for editing a
 * signature. Images (a logo or photo) are kept in the signature itself, like Roundcube:
 * up to 3 PNG, JPEG or GIF images of 64 KB each, checked again by the server.
 */
export default function SignatureEditor({ initial, onChange }: { initial: JSONContent; onChange: (doc: JSONContent) => void }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [imageError, setImageError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: emailExtensions({ placeholder: 'Your name, role, phone number…', onLinkShortcut: () => setLinkOpen(true) }),
    content: initial,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { 'aria-label': 'Signature', 'aria-multiline': 'true', class: 'fx-body' },
      // Pasted images are dropped; images are added with the image button, so their size is checked.
      transformPastedHTML: (html) => cleanPastedHtml(html),
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON()),
  });

  const items = useMemo<Record<string, ToolbarItem>>(
    () => ({
      ...BUILTIN_ITEMS,
      signatureImage: {
        id: 'signatureImage',
        label: `Add an image, such as your logo (PNG, JPEG or GIF, up to ${kb(MAX_SIGNATURE_IMAGE_BYTES)})`,
        icon: EditorIcon.image,
        run: () => fileInput.current?.click(),
      },
    }),
    [],
  );

  async function addImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be chosen again
    if (!file || !editor) return;
    setImageError('');
    if (!SIGNATURE_IMAGE_TYPES.includes(file.type)) {
      setImageError('Use a PNG, JPEG or GIF image. Other formats do not show in every mail app.');
      return;
    }
    if (file.size > MAX_SIGNATURE_IMAGE_BYTES) {
      setImageError(`This image is ${kb(file.size)}. Signature images can be up to ${kb(MAX_SIGNATURE_IMAGE_BYTES)}. Try a smaller version of your logo.`);
      return;
    }
    if (countImages(editor.getJSON()) >= MAX_SIGNATURE_IMAGES) {
      setImageError(`A signature can have up to ${MAX_SIGNATURE_IMAGES} images.`);
      return;
    }
    const src = await readAsDataUrl(file);
    const alt = file.name.replace(/\.[^.]+$/, '').slice(0, 100);
    editor.chain().focus().insertContent({ type: 'image', attrs: { src, alt } }).run();
  }

  if (!editor) return null;
  const ctx: ToolbarContext = { editor, openLink: () => setLinkOpen(true) };

  return (
    <div className="fx-composer signature-editor">
      <Toolbar entries={ENTRIES} items={items} ctx={ctx} label="Signature formatting" />
      <div className="fx-editor-wrap">
        <EditorContent editor={editor} />
        {linkOpen && <LinkDialog editor={editor} onClose={() => setLinkOpen(false)} />}
      </div>
      <input ref={fileInput} type="file" accept={SIGNATURE_IMAGE_TYPES.join(',')} hidden onChange={addImage} aria-hidden="true" tabIndex={-1} />
      {imageError && <div className="notice error signature-image-error" role="alert">{Icon.alert}<span>{imageError}</span></div>}
    </div>
  );
}
