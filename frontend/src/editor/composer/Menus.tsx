import { getMarkRange, type Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { BubbleMenu, FloatingMenu } from '@tiptap/react/menus';
import { useState } from 'react';
import { linkTextMismatch } from '../linkcheck';
import { Icon } from './icons';
import { MenuButton } from './Popover';
import { ColorPanel } from './Toolbar';

const c = (e: Editor) => e.chain().focus();

function Btn(props: { label: string; icon: React.ReactNode; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      className={`fx-btn${props.danger ? ' fx-danger' : ''}`}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
    >
      {props.icon}
    </button>
  );
}

const isNodeSel = (e: Editor, name: string) => e.state.selection instanceof NodeSelection && e.state.selection.node.type.name === name;

// shouldShow and options must keep the same identity between renders: BubbleMenu and
// FloatingMenu re-register their plugin when these props change, and with
// shouldRerenderOnTransaction that would loop forever.
type ShowArgs = { editor: Editor; state: Editor['state'] };
const showSelection = ({ editor: e, state }: ShowArgs) => e.isEditable && !state.selection.empty && !(state.selection instanceof NodeSelection);
const showLink = ({ editor: e, state }: ShowArgs) => state.selection.empty && e.isActive('link');
const showTable = ({ editor: e, state }: ShowArgs) => e.isActive('table') && state.selection.empty;
const showImage = ({ editor: e }: ShowArgs) => isNodeSel(e, 'image');
const showInsert = ({ editor: e, state }: ShowArgs) => {
  const { $from, empty } = state.selection;
  return e.isEditable && empty && $from.depth === 1 && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0;
};
const TOP = { placement: 'top', offset: 8 } as const;
const BELOW = { placement: 'bottom-start', offset: 6 } as const;
const LEFT = { placement: 'left', offset: 8 } as const;

/** Shown over selected text: quick formatting, Medium/Notion style. */
export function SelectionBubble({ editor, openLink }: { editor: Editor; openLink: () => void }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="fxSelection"
      options={TOP}
      shouldShow={showSelection}
      className="fx-bubble"
      role="toolbar"
      aria-label="Selected text"
    >
      <Btn label="Bold" icon={Icon.bold} active={editor.isActive('bold')} onClick={() => c(editor).toggleBold().run()} />
      <Btn label="Italic" icon={Icon.italic} active={editor.isActive('italic')} onClick={() => c(editor).toggleItalic().run()} />
      <Btn label="Underline" icon={Icon.underline} active={editor.isActive('underline')} onClick={() => c(editor).toggleUnderline().run()} />
      <Btn label="Strikethrough" icon={Icon.strike} active={editor.isActive('strike')} onClick={() => c(editor).toggleStrike().run()} />
      <span className="fx-color-trigger" style={{ ['--fx-swatch' as string]: editor.getAttributes('textStyle').color ?? '#000000' }}>
        <MenuButton label="Text colour" icon={Icon.textColor} placement="down" role="dialog">
          {(close) => <ColorPanel editor={editor} close={close} />}
        </MenuButton>
      </span>
      <Btn label="Insert link" icon={Icon.link} active={editor.isActive('link')} onClick={openLink} />
      <Btn label="Remove formatting" icon={Icon.clear} onClick={() => c(editor).unsetAllMarks().run()} />
    </BubbleMenu>
  );
}

/** Shown when the cursor is inside a link: where it goes, open, change, remove. */
export function LinkBubble({ editor, openLink }: { editor: Editor; openLink: () => void }) {
  const href: string = editor.getAttributes('link').href ?? '';
  const range = editor.isActive('link') ? getMarkRange(editor.state.selection.$from, editor.schema.marks.link) : undefined;
  const text = range ? editor.state.doc.textBetween(range.from, range.to) : '';
  const mismatch = linkTextMismatch(text, href);
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="fxLink"
      options={BELOW}
      shouldShow={showLink}
      className="fx-bubble fx-link-bubble"
      role="toolbar"
      aria-label="Link"
    >
      <a className="fx-href" href={href} target="_blank" rel="noopener noreferrer" title={href}>
        {Icon.external}
        <span>{href.replace(/^mailto:/, '')}</span>
      </a>
      <button type="button" className="fx-plain" onMouseDown={(e) => e.preventDefault()} onClick={openLink}>Change</button>
      <button type="button" className="fx-plain" onMouseDown={(e) => e.preventDefault()} onClick={() => c(editor).extendMarkRange('link').unsetLink().run()}>Remove</button>
      {mismatch && <div className="fx-warn" role="note">The text shows a different address from where this link goes.</div>}
    </BubbleMenu>
  );
}

/** Shown inside a table: rows, columns, header row, delete. */
export function TableBubble({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="fxTable"
      options={TOP}
      shouldShow={showTable}
      className="fx-bubble fx-table-bubble"
      role="toolbar"
      aria-label="Table"
    >
      <button type="button" className="fx-plain" onClick={() => c(editor).addRowBefore().run()}>Row above</button>
      <button type="button" className="fx-plain" onClick={() => c(editor).addRowAfter().run()}>Row below</button>
      <button type="button" className="fx-plain" onClick={() => c(editor).addColumnBefore().run()}>Column left</button>
      <button type="button" className="fx-plain" onClick={() => c(editor).addColumnAfter().run()}>Column right</button>
      <button type="button" className="fx-plain" onClick={() => c(editor).toggleHeaderRow().run()}>Header row</button>
      <button type="button" className="fx-plain" onClick={() => c(editor).deleteRow().run()}>Delete row</button>
      <button type="button" className="fx-plain" onClick={() => c(editor).deleteColumn().run()}>Delete column</button>
      <Btn label="Delete table" icon={Icon.trash} danger onClick={() => c(editor).deleteTable().run()} />
    </BubbleMenu>
  );
}

/** Shown when an image is selected: Gmail's Small / Best fit / Original size / Remove. */
export function ImageBubble({ editor }: { editor: Editor }) {
  const size = (width: number | null) => c(editor).updateAttributes('image', { width, height: null }).run();
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="fxImage"
      options={TOP}
      shouldShow={showImage}
      className="fx-bubble"
      role="toolbar"
      aria-label="Image"
    >
      <button type="button" className="fx-plain" onClick={() => size(160)}>Small</button>
      <button type="button" className="fx-plain" onClick={() => size(320)}>Best fit</button>
      <button type="button" className="fx-plain" onClick={() => size(null)}>Original size</button>
      <Btn label="Remove image" icon={Icon.trash} danger onClick={() => c(editor).deleteSelection().run()} />
    </BubbleMenu>
  );
}

/** "+" on an empty line: insert a block (Notion style). */
export function InsertMenu({ editor, pickImage }: { editor: Editor; pickImage: () => void }) {
  const [open, setOpen] = useState(false);
  const item = (label: string, icon: React.ReactNode, run: () => void) => (
    <button type="button" className="fx-menuitem" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => (run(), setOpen(false))}>
      {icon}
      <span>{label}</span>
    </button>
  );
  return (
    <FloatingMenu
      editor={editor}
      pluginKey="fxInsert"
      options={LEFT}
      className="fx-floating"
      shouldShow={showInsert}
    >
      <button
        type="button"
        className="fx-btn fx-plus"
        aria-label="Insert"
        title="Insert"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        {Icon.plus}
      </button>
      {open && (
        <div className="fx-pop fx-insert" role="menu" aria-label="Insert" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          {item('Bulleted list', Icon.listBullet, () => c(editor).toggleBulletList().run())}
          {item('Numbered list', Icon.listNumber, () => c(editor).toggleOrderedList().run())}
          {item('Quote', Icon.quote, () => c(editor).toggleBlockquote().run())}
          {item('Table', Icon.table, () => c(editor).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
          {item('Image', Icon.image, pickImage)}
          {item('Divider', Icon.hr, () => c(editor).setHorizontalRule().run())}
        </div>
      )}
    </FloatingMenu>
  );
}
