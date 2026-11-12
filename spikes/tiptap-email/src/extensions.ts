import { Extension, mergeAttributes, Node, type AnyExtension } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { BackgroundColor, Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import { StarterKit } from '@tiptap/starter-kit';
import { INDENT_PX, MAX_INDENT, safeHref } from './allowlist';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    direction: {
      /** null means "auto": detected from the text when the message is sent. */
      setDirection: (dir: 'ltr' | 'rtl' | null) => ReturnType;
    };
    emailSignature: {
      /** Replaces any signature block; null removes it. */
      setSignature: (signatureId: string | null) => ReturnType;
    };
    indent: {
      /** Indents list items (nesting) or paragraphs and headings (margin). */
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

const INDENT_TYPES = ['paragraph', 'heading'];

/** Gmail-style indent: lists nest, other blocks get a margin step (max MAX_INDENT). */
export const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [
      {
        types: INDENT_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Math.min(MAX_INDENT, Math.max(0, parseInt(el.getAttribute('data-indent') ?? '0', 10) || 0)),
            renderHTML: (attrs) =>
              attrs.indent ? { 'data-indent': attrs.indent, style: `margin-inline-start:${attrs.indent * INDENT_PX}px` } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    const step =
      (delta: number) =>
      ({ tr, state, dispatch }: any) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node: any, pos: number) => {
          if (!INDENT_TYPES.includes(node.type.name)) return;
          const next = Math.min(MAX_INDENT, Math.max(0, (node.attrs.indent ?? 0) + delta));
          if (next !== node.attrs.indent) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
            changed = true;
          }
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      };
    return {
      indent:
        () =>
        (props) =>
          props.editor.isActive('listItem') ? props.commands.sinkListItem('listItem') : step(1)(props),
      outdent:
        () =>
        (props) =>
          props.editor.isActive('listItem') ? props.commands.liftListItem('listItem') : step(-1)(props),
    };
  },
});

export interface ShortcutOptions {
  onLink: () => void;
}

/** Gmail shortcuts not covered by Tiptap's defaults. */
export const ComposerShortcuts = Extension.create<ShortcutOptions>({
  name: 'composerShortcuts',
  addOptions() {
    return { onLink: () => {} };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        this.options.onLink();
        return true;
      },
      'Mod-\\': () => this.editor.chain().focus().unsetAllMarks().run(),
      'Mod-]': () => this.editor.commands.indent(),
      'Mod-[': () => this.editor.commands.outdent(),
    };
  },
});

const DIR_TYPES = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList'];

/** Per-block text direction. Rendered as dir="auto" in the editor when unset. */
export const Direction = Extension.create({
  name: 'direction',
  addGlobalAttributes() {
    return [
      {
        types: DIR_TYPES,
        attributes: {
          dir: {
            default: null,
            parseHTML: (el) => {
              const d = el.getAttribute('dir');
              return d === 'rtl' || d === 'ltr' ? d : null;
            },
            renderHTML: (attrs) => ({ dir: attrs.dir ?? 'auto' }),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setDirection:
        (dir) =>
        ({ chain }) =>
          chain().updateAttributes('paragraph', { dir }).updateAttributes('heading', { dir }).run(),
    };
  },
});

/**
 * Inline image that only exists as a local preview (blob: URL) plus a content id.
 * It is sent as a cid: attachment, so the editor never loads remote content.
 */
export const EmailImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      contentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-content-id'),
        renderHTML: (attrs) => (attrs.contentId ? { 'data-content-id': attrs.contentId } : {}),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'img[src][data-content-id]',
        getAttrs: (el) => ((el as HTMLElement).getAttribute('src') ?? '').startsWith('blob:') && null,
      },
    ];
  },
}).configure({
  inline: true,
  allowBase64: false,
  resize: { enabled: true, minWidth: 40, minHeight: 20, alwaysPreserveAspectRatio: true },
});

export interface SignatureOptions {
  /** Plain-text preview shown inside the editor for a signature id. */
  preview: (signatureId: string) => string;
}

/**
 * Signature block: one atomic node holding only a reference. The signature's own
 * content is merged in when the message is serialized, so typing can never damage it.
 * It is not parsed from HTML, so pasted markup cannot create one.
 */
export const EmailSignature = Node.create<SignatureOptions>({
  name: 'emailSignature',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addOptions() {
    return { preview: () => '' };
  },
  addAttributes() {
    return { signatureId: { default: null } };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'fx-signature', contenteditable: 'false' })];
  },
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'fx-signature';
      dom.contentEditable = 'false';
      dom.dir = 'auto';
      // textContent, never innerHTML: the preview is plain text.
      dom.textContent = `-- \n${this.options.preview(node.attrs.signatureId)}`;
      return { dom };
    };
  },
  addCommands() {
    return {
      setSignature:
        (signatureId) =>
        ({ tr, state, dispatch }) => {
          if (dispatch) {
            const found: number[] = [];
            state.doc.descendants((n, pos) => {
              if (n.type.name === this.name) found.push(pos);
            });
            for (const pos of found.reverse()) tr.delete(pos, pos + 1);
            if (signatureId) tr.insert(tr.doc.content.size, this.type.create({ signatureId }));
          }
          return true;
        },
    };
  },
});

export interface EmailExtensionOptions {
  signaturePreview?: (signatureId: string) => string;
  placeholder?: string;
  onLinkShortcut?: () => void;
  /** Extra Tiptap extensions. Give each new node an email serializer (SerializeContext.nodes). */
  extra?: AnyExtension[];
}

/** The complete, restricted extension set for the email composer. */
export function emailExtensions(opts: EmailExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      trailingNode: false, // keeps the signature block last
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        isAllowedUri: (url, { defaultValidate }) => defaultValidate(url) && safeHref(url) !== null,
      },
    }),
    TextStyle,
    Color,
    BackgroundColor,
    FontFamily,
    FontSize,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'center', 'right', 'justify'],
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Direction,
    Indent,
    EmailImage,
    EmailSignature.configure({ preview: opts.signaturePreview ?? (() => '') }),
    Placeholder.configure({ placeholder: opts.placeholder ?? '' }),
    ComposerShortcuts.configure({ onLink: opts.onLinkShortcut ?? (() => {}) }),
    ...(opts.extra ?? []),
  ];
}
