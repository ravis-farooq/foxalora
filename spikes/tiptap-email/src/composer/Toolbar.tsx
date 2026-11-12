import type { Editor } from '@tiptap/core';
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { COLORS, FONT_MENU, SIZE_MENU } from '../allowlist';
import { Icon } from './icons';
import { MenuButton, MenuItem } from './Popover';

export interface ToolbarContext {
  editor: Editor;
  openLink: () => void;
}

/** A toolbar button. Give `run` for a plain button or `render` for anything custom. */
export interface ToolbarItem {
  id: string;
  label: string;
  shortcut?: string;
  icon?: ReactNode;
  isActive?: (editor: Editor) => boolean;
  isDisabled?: (editor: Editor) => boolean;
  run?: (ctx: ToolbarContext) => void;
  render?: (ctx: ToolbarContext) => ReactNode;
}

/** An item id, a custom item, or '|' for a separator. */
export type ToolbarEntry = string | ToolbarItem;

/** Gmail's formatting bar, in Gmail's order. */
export const DEFAULT_TOOLBAR: ToolbarEntry[] = [
  'undo', 'redo', '|', 'font', '|', 'size', '|', 'bold', 'italic', 'underline', 'color', '|',
  'align', '|', 'orderedList', 'bulletList', '|', 'outdent', 'indent', '|', 'quote', 'strike', 'clear',
];

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
const c = (e: Editor) => e.chain().focus();

export function ColorPanel({ editor, close }: { editor: Editor; close: () => void }) {
  const cur = editor.getAttributes('textStyle');
  const grid = (value: string | undefined, pick: (col: string) => void, name: string) => (
    <div className="fx-swatches" role="group" aria-label={name}>
      {COLORS.map((col) => (
        <button
          key={col}
          type="button"
          className="fx-swatch-btn"
          style={{ background: col }}
          aria-label={`${name} ${col}`}
          aria-pressed={value?.toLowerCase() === col}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (pick(col), close())}
        />
      ))}
    </div>
  );
  return (
    <div className="fx-colors">
      <div>
        <div className="fx-pop-title">Background colour</div>
        {grid(cur.backgroundColor, (col) => c(editor).setBackgroundColor(col).run(), 'Background colour')}
        <button type="button" className="fx-link-btn" onClick={() => (c(editor).unsetBackgroundColor().run(), close())}>Remove</button>
      </div>
      <div>
        <div className="fx-pop-title">Text colour</div>
        {grid(cur.color, (col) => c(editor).setColor(col).run(), 'Text colour')}
        <button type="button" className="fx-link-btn" onClick={() => (c(editor).unsetColor().run(), close())}>Reset</button>
      </div>
    </div>
  );
}

const simple = (id: string, label: string, icon: ReactNode, run: (e: Editor) => void, active?: (e: Editor) => boolean, shortcut?: string): ToolbarItem => ({
  id, label, icon, shortcut, isActive: active, run: ({ editor }) => run(editor),
});

export const BUILTIN_ITEMS: Record<string, ToolbarItem> = {
  undo: { ...simple('undo', 'Undo', Icon.undo, (e) => c(e).undo().run(), undefined, `${mod}Z`), isDisabled: (e) => !e.can().undo() },
  redo: { ...simple('redo', 'Redo', Icon.redo, (e) => c(e).redo().run(), undefined, `${mod}Y`), isDisabled: (e) => !e.can().redo() },
  bold: simple('bold', 'Bold', Icon.bold, (e) => c(e).toggleBold().run(), (e) => e.isActive('bold'), `${mod}B`),
  italic: simple('italic', 'Italic', Icon.italic, (e) => c(e).toggleItalic().run(), (e) => e.isActive('italic'), `${mod}I`),
  underline: simple('underline', 'Underline', Icon.underline, (e) => c(e).toggleUnderline().run(), (e) => e.isActive('underline'), `${mod}U`),
  strike: simple('strike', 'Strikethrough', Icon.strike, (e) => c(e).toggleStrike().run(), (e) => e.isActive('strike'), `${mod}Shift+S`),
  orderedList: simple('orderedList', 'Numbered list', Icon.listNumber, (e) => c(e).toggleOrderedList().run(), (e) => e.isActive('orderedList'), `${mod}Shift+7`),
  bulletList: simple('bulletList', 'Bulleted list', Icon.listBullet, (e) => c(e).toggleBulletList().run(), (e) => e.isActive('bulletList'), `${mod}Shift+8`),
  outdent: simple('outdent', 'Indent less', Icon.outdent, (e) => c(e).outdent().run(), undefined, `${mod}[`),
  indent: simple('indent', 'Indent more', Icon.indent, (e) => c(e).indent().run(), undefined, `${mod}]`),
  quote: simple('quote', 'Quote', Icon.quote, (e) => c(e).toggleBlockquote().run(), (e) => e.isActive('blockquote'), `${mod}Shift+B`),
  clear: simple('clear', 'Remove formatting', Icon.clear, (e) => c(e).unsetAllMarks().run(), undefined, `${mod}\\`),
  link: { id: 'link', label: 'Insert link', icon: Icon.link, shortcut: `${mod}K`, isActive: (e) => e.isActive('link'), run: ({ openLink }) => openLink() },
  font: {
    id: 'font',
    label: 'Font',
    render: ({ editor }) => {
      const cur = editor.getAttributes('textStyle').fontFamily ?? '';
      const label = FONT_MENU.find((f) => f.value === cur)?.label ?? 'Sans Serif';
      return (
        <MenuButton label="Font" icon={null} text={label} chevron>
          {(close) =>
            FONT_MENU.map((f) => (
              <MenuItem
                key={f.label}
                label={f.label}
                checked={f.value === cur}
                style={{ fontFamily: f.value || 'Arial' }}
                onSelect={() => (f.value ? c(editor).setFontFamily(f.value).run() : c(editor).unsetFontFamily().run(), close())}
              />
            ))
          }
        </MenuButton>
      );
    },
  },
  size: {
    id: 'size',
    label: 'Size',
    render: ({ editor }) => {
      const cur = editor.getAttributes('textStyle').fontSize ?? '';
      return (
        <MenuButton label="Size" icon={Icon.size} chevron>
          {(close) =>
            SIZE_MENU.map((s) => (
              <MenuItem
                key={s.label}
                label={s.label}
                checked={s.value === cur}
                style={{ fontSize: s.value || '14px' }}
                onSelect={() => (s.value ? c(editor).setFontSize(s.value).run() : c(editor).unsetFontSize().run(), close())}
              />
            ))
          }
        </MenuButton>
      );
    },
  },
  color: {
    id: 'color',
    label: 'Text colour',
    render: ({ editor }) => (
      <span className="fx-color-trigger" style={{ ['--fx-swatch' as string]: editor.getAttributes('textStyle').color ?? '#000000' }}>
        <MenuButton label="Text colour" icon={Icon.textColor} chevron role="dialog">
          {(close) => <ColorPanel editor={editor} close={close} />}
        </MenuButton>
      </span>
    ),
  },
  align: {
    id: 'align',
    label: 'Align',
    render: ({ editor }) => {
      const opts = [
        ['left', 'Align left', Icon.alignLeft, 'Shift+L'],
        ['center', 'Align centre', Icon.alignCenter, 'Shift+E'],
        ['right', 'Align right', Icon.alignRight, 'Shift+R'],
        ['justify', 'Justify', Icon.alignJustify, 'Shift+J'],
      ] as const;
      const cur = opts.find(([v]) => editor.isActive({ textAlign: v }))?.[2] ?? Icon.alignLeft;
      return (
        <MenuButton label="Align" icon={cur} chevron>
          {(close) => (
            <div className="fx-row">
              {opts.map(([v, label, icon, key]) => (
                <button
                  key={v}
                  type="button"
                  className="fx-btn"
                  aria-label={label}
                  title={`${label} (${mod}${key})`}
                  aria-pressed={editor.isActive({ textAlign: v })}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (c(editor).setTextAlign(v).run(), close())}
                >
                  {icon}
                </button>
              ))}
            </div>
          )}
        </MenuButton>
      );
    },
  },
};

/** Renders a single item (built-in id or custom object). */
export function renderItem(entry: ToolbarItem, ctx: ToolbarContext, key: string) {
  if (entry.render) return <span key={key}>{entry.render(ctx)}</span>;
  const title = entry.shortcut ? `${entry.label} (${entry.shortcut})` : entry.label;
  return (
    <button
      key={key}
      type="button"
      data-tb
      className="fx-btn"
      aria-label={entry.label}
      title={title}
      aria-pressed={entry.isActive ? entry.isActive(ctx.editor) : undefined}
      disabled={entry.isDisabled?.(ctx.editor)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => entry.run?.(ctx)}
    >
      {entry.icon ?? entry.label}
    </button>
  );
}

/**
 * Formatting bar. role="toolbar" with roving focus: one Tab stop, arrow keys move
 * between controls (WAI-ARIA toolbar pattern).
 */
export function Toolbar({ entries, items, ctx, label }: { entries: ToolbarEntry[]; items: Record<string, ToolbarItem>; ctx: ToolbarContext; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Exactly one control is in the Tab order: the last one focused, else the first.
  useLayoutEffect(() => {
    // Disabled buttons cannot take focus, so they never hold the Tab stop.
    const els = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[data-tb]') ?? [])];
    const enabled = els.filter((el) => !el.disabled);
    const current = enabled.find((el) => el.dataset.rove === '1') ?? enabled[0];
    els.forEach((el) => (el.tabIndex = el === current ? 0 : -1));
  });
  const onKeyDown = (e: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const els = [...(ref.current?.querySelectorAll<HTMLElement>('[data-tb]:not(:disabled)') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (i === -1) return;
    e.preventDefault();
    const rtl = getComputedStyle(ref.current!).direction === 'rtl';
    const fwd = (e.key === 'ArrowRight') !== rtl;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : (i + (fwd ? 1 : -1) + els.length) % els.length;
    els.forEach((el, j) => {
      el.tabIndex = j === next ? 0 : -1;
      el.dataset.rove = j === next ? '1' : '';
    });
    els[next].focus();
  };
  return (
    <div ref={ref} className="fx-toolbar" role="toolbar" aria-label={label} onKeyDown={onKeyDown}>
      {entries.map((entry, i) => {
        if (entry === '|') return <span key={`sep${i}`} className="fx-sep" aria-hidden="true" />;
        const item = typeof entry === 'string' ? items[entry] : entry;
        return item ? renderItem(item, ctx, `${item.id}${i}`) : null;
      })}
    </div>
  );
}
