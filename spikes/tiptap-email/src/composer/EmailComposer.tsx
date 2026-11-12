import type { AnyExtension, Editor, JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { emailExtensions } from '../extensions';
import { ImageStore } from '../images';
import { cleanPastedHtml } from '../paste';
import { serializeEmail, type EmailOutput, type NodeSerializer, type QuotedOriginal } from '../serialize';
import { Icon } from './icons';
import { LinkDialog } from './LinkDialog';
import { ImageBubble, InsertMenu, LinkBubble, SelectionBubble, TableBubble } from './Menus';
import { MenuButton, MenuItem } from './Popover';
import { BUILTIN_ITEMS, DEFAULT_TOOLBAR, Toolbar, type ToolbarContext, type ToolbarEntry, type ToolbarItem } from './Toolbar';
import './composer.css';

export interface Signature {
  label: string;
  content: JSONContent;
}

export interface EmailComposerProps {
  initialContent?: JSONContent | string;
  placeholder?: string;
  signatures?: Record<string, Signature>;
  defaultSignatureId?: string;
  /** Original message when replying or forwarding (HTML already sanitized by the server). */
  quoted?: QuotedOriginal;
  /** Shared image store; one is created when omitted. */
  images?: ImageStore;
  /** Formatting bar layout: built-in ids, '|' separators and custom items. */
  toolbar?: ToolbarEntry[];
  /** Extra Tiptap extensions, and email output for any new node types they add. */
  extensions?: AnyExtension[];
  nodeSerializers?: Record<string, NodeSerializer>;
  onChange?: (out: EmailOutput, json: JSONContent) => void;
  onSend?: (out: EmailOutput) => void;
  onDiscard?: () => void;
  /** Gives the host page the editor instance (tests, samples, integrations). */
  onReady?: (editor: Editor) => void;
}

/** Inserts image files as inline (cid) images; at `pos` when dropped. */
function insertImages(editor: Editor, store: ImageStore, files: File[], pos?: number) {
  for (const file of files) {
    const img = store.add(file, file.name);
    if (!img) continue;
    const content = { type: 'image', attrs: { src: img.previewUrl, alt: file.name, contentId: img.contentId } };
    if (pos === undefined) editor.chain().focus().insertContent(content).run();
    else editor.chain().focus().insertContentAt(pos, content).run();
  }
}

export function EmailComposer(props: EmailComposerProps) {
  const store = useMemo(() => props.images ?? new ImageStore(), [props.images]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [showFormat, setShowFormat] = useState(true);
  const [showQuoted, setShowQuoted] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const openLinkRef = useRef(() => setLinkOpen(true));
  const editorRef = useRef<Editor | null>(null);
  const signatures = props.signatures ?? {};

  const editor = useEditor({
    extensions: emailExtensions({
      placeholder: props.placeholder ?? 'Compose email',
      signaturePreview: (id) => serializeEmail(signatures[id]?.content ?? { type: 'doc' }).text.trim(),
      onLinkShortcut: () => openLinkRef.current(),
      extra: props.extensions,
    }),
    content: props.initialContent ?? '',
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { 'aria-label': 'Message body', 'aria-multiline': 'true', class: 'fx-body' },
      transformPastedHTML: (html) => cleanPastedHtml(html, { registerImage: (d) => store.addDataUrl(d) }),
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (!files.length || event.clipboardData?.getData('text/html') || !editorRef.current) return false;
        insertImages(editorRef.current, store, files);
        return true;
      },
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (!files.length || !editorRef.current) return false;
        event.preventDefault();
        insertImages(editorRef.current, store, files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    // The default signature is part of the starting state, not an undoable edit.
    if (props.defaultSignatureId) editor.chain().setMeta('addToHistory', false).setSignature(props.defaultSignatureId).run();
    props.onReady?.(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const out = useMemo(
    () =>
      editor &&
      serializeEmail(editor.getJSON(), {
        signatures: Object.fromEntries(Object.entries(signatures).map(([id, s]) => [id, s.content])),
        quoted: props.quoted,
        isKnownImage: (id) => !!store.get(id),
        nodes: props.nodeSerializers,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor?.state.doc, props.quoted, signatures, props.nodeSerializers],
  );

  useEffect(() => {
    if (editor && out) props.onChange?.(out, editor.getJSON());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [out]);

  if (!editor || !out) return null;

  const ctx: ToolbarContext = { editor, openLink: () => setLinkOpen(true) };
  const items: Record<string, ToolbarItem> = { ...BUILTIN_ITEMS };
  const entries = props.toolbar ?? DEFAULT_TOOLBAR;
  const sigId = editor.$node('emailSignature')?.attributes.signatureId as string | undefined;
  const dir = editor.getAttributes('paragraph').dir ?? null;

  return (
    <div className="fx-composer">
      <div className="fx-editor-wrap">
        <EditorContent editor={editor} />
        <SelectionBubble editor={editor} openLink={ctx.openLink} />
        <LinkBubble editor={editor} openLink={ctx.openLink} />
        <TableBubble editor={editor} />
        <ImageBubble editor={editor} />
        <InsertMenu editor={editor} pickImage={() => fileInput.current?.click()} />
        {linkOpen && <LinkDialog editor={editor} onClose={() => setLinkOpen(false)} />}
      </div>

      {props.quoted && (
        <div className="fx-quoted">
          <button
            type="button"
            className="fx-btn fx-dots"
            aria-label={showQuoted ? 'Hide quoted text' : 'Show quoted text'}
            title={showQuoted ? 'Hide quoted text' : 'Show quoted text'}
            aria-expanded={showQuoted}
            onClick={() => setShowQuoted((s) => !s)}
          >
            •••
          </button>
          {showQuoted && (
            <blockquote dir="auto">
              <div>{props.quoted.header}</div>
              <div className="fx-quoted-text">{props.quoted.text}</div>
            </blockquote>
          )}
        </div>
      )}

      {showFormat && <Toolbar entries={entries} items={items} ctx={ctx} label="Formatting options" />}

      <div className="fx-actions" role="toolbar" aria-label="Message actions">
        <button type="button" className="fx-send" onClick={() => props.onSend?.(out)}>Send</button>
        <button
          type="button"
          className="fx-btn"
          aria-label="Formatting options"
          title="Formatting options"
          aria-pressed={showFormat}
          onClick={() => setShowFormat((s) => !s)}
        >
          {Icon.format}
        </button>
        <button type="button" className="fx-btn" aria-label="Insert link" title="Insert link" onMouseDown={(e) => e.preventDefault()} onClick={ctx.openLink}>
          {Icon.link}
        </button>
        <button type="button" className="fx-btn" aria-label="Insert photo" title="Insert photo" onClick={() => fileInput.current?.click()}>
          {Icon.image}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            insertImages(editor, store, [...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <MenuButton label="Insert table" icon={Icon.table}>
          {(close) =>
            [
              [2, 2],
              [3, 3],
              [4, 3],
              [5, 4],
            ].map(([rows, cols]) => (
              <MenuItem
                key={`${rows}x${cols}`}
                label={`${cols} × ${rows} with header row`}
                onSelect={() => (editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run(), close())}
              />
            ))
          }
        </MenuButton>
        {Object.keys(signatures).length > 0 && (
          <MenuButton label="Insert signature" icon={Icon.signature} active={!!sigId}>
            {(close) => (
              <>
                <MenuItem label="No signature" checked={!sigId} onSelect={() => (editor.chain().focus().setSignature(null).run(), close())} />
                {Object.entries(signatures).map(([id, s]) => (
                  <MenuItem key={id} label={s.label} checked={sigId === id} onSelect={() => (editor.chain().focus().setSignature(id).run(), close())} />
                ))}
              </>
            )}
          </MenuButton>
        )}
        <MenuButton label="Text direction" icon={Icon.direction} active={!!dir}>
          {(close) => (
            <>
              <MenuItem label="Automatic" checked={!dir} onSelect={() => (editor.chain().focus().setDirection(null).run(), close())} />
              <MenuItem label="Left to right" checked={dir === 'ltr'} onSelect={() => (editor.chain().focus().setDirection('ltr').run(), close())} />
              <MenuItem label="Right to left" checked={dir === 'rtl'} onSelect={() => (editor.chain().focus().setDirection('rtl').run(), close())} />
            </>
          )}
        </MenuButton>
        <span className="fx-grow" />
        {props.onDiscard && (
          <button type="button" className="fx-btn" aria-label="Discard draft" title="Discard draft" onClick={props.onDiscard}>
            {Icon.trash}
          </button>
        )}
      </div>
    </div>
  );
}
