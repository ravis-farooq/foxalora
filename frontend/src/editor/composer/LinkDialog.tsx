import { getMarkRange, type Editor } from '@tiptap/core';
import { useState, type FormEvent } from 'react';
import { safeHref } from '../allowlist';

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Resolves what the user typed into a safe href: an email address becomes mailto:. */
export function linkTarget(input: string): string | null {
  const v = input.trim();
  const bare = v.replace(/^mailto:/i, '');
  if (EMAIL.test(bare)) return `mailto:${bare}`;
  return safeHref(v);
}

function currentLink(editor: Editor) {
  const { state } = editor;
  const type = state.schema.marks.link;
  const range = getMarkRange(state.selection.$from, type);
  if (range && state.selection.empty) {
    return { range, text: state.doc.textBetween(range.from, range.to), href: editor.getAttributes('link').href ?? '' };
  }
  const { from, to } = state.selection;
  return { range: { from, to }, text: state.doc.textBetween(from, to, ' '), href: editor.getAttributes('link').href ?? '' };
}

/** Gmail-style "Edit link" dialog: text to display, then a web or email address. */
export function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [initial] = useState(() => currentLink(editor));
  const [text, setText] = useState(initial.text);
  const [addr, setAddr] = useState(initial.href.replace(/^mailto:/, ''));
  const [error, setError] = useState('');
  const target = linkTarget(addr);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!target) {
      setError('Enter a web address (https://…) or an email address.');
      return;
    }
    const display = text.trim() || addr.trim();
    const chain = editor.chain().focus();
    if (initial.range.from !== initial.range.to && display === initial.text) {
      // Same text: only (re)link it, keeping bold/colour on the existing text.
      chain.setTextSelection(initial.range).extendMarkRange('link').setLink({ href: target }).run();
    } else {
      chain
        .insertContentAt(initial.range, { type: 'text', text: display, marks: [{ type: 'link', attrs: { href: target } }] })
        .run();
    }
    onClose();
  };

  const remove = () => {
    editor.chain().focus().setTextSelection(initial.range).extendMarkRange('link').unsetLink().run();
    onClose();
  };

  return (
    <div
      className="fx-dialog"
      role="dialog"
      aria-modal="false"
      aria-labelledby="fx-link-title"
      onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose(), editor.commands.focus())}
    >
      <form onSubmit={submit}>
        <h2 id="fx-link-title" className="fx-dialog-title">{initial.href ? 'Edit link' : 'Insert link'}</h2>
        <label className="fx-field">
          Text to display
          <input value={text} onChange={(e) => setText(e.target.value)} autoFocus={!!initial.text === false} />
        </label>
        <label className="fx-field">
          Web address or email address
          <input
            value={addr}
            autoFocus={!!initial.text}
            inputMode="url"
            placeholder="https://example.com or name@example.com"
            aria-invalid={!!error}
            aria-describedby="fx-link-err"
            onChange={(e) => (setAddr(e.target.value), setError(''))}
          />
        </label>
        <div id="fx-link-err" className="fx-error" role="alert">{error}</div>
        {target?.startsWith('http') && (
          <a className="fx-test-link" href={target} target="_blank" rel="noopener noreferrer">Test this link</a>
        )}
        <div className="fx-dialog-actions">
          {initial.href && <button type="button" className="fx-plain" onClick={remove}>Remove link</button>}
          <span className="fx-grow" />
          <button type="button" className="fx-plain" onClick={() => (onClose(), editor.commands.focus())}>Cancel</button>
          <button type="submit" className="fx-primary">OK</button>
        </div>
      </form>
    </div>
  );
}
