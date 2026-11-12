import { serializeEmail } from '../../src/editor/serialize';
import { findAll, makeEditor } from './helpers';

describe('email schema', () => {
  it('has tables but no code or code block', () => {
    const { editor } = makeEditor();
    const names = Object.keys(editor.schema.nodes).concat(Object.keys(editor.schema.marks));
    expect(names).not.toContain('codeBlock');
    expect(names).not.toContain('code');
    expect(names).toEqual(expect.arrayContaining(['table', 'tableRow', 'tableHeader', 'tableCell']));
  });

  it('indents paragraphs by steps and nests list items', () => {
    const { editor } = makeEditor('<p>Para</p><ul><li><p>one</p></li><li><p>two</p></li></ul>');
    editor.commands.setTextSelection(2);
    editor.commands.indent();
    editor.commands.indent();
    expect(editor.getJSON().content![0].attrs!.indent).toBe(2);
    for (let i = 0; i < 9; i++) editor.commands.indent();
    expect(editor.getJSON().content![0].attrs!.indent).toBe(4); // capped
    editor.commands.outdent();
    expect(editor.getJSON().content![0].attrs!.indent).toBe(3);
    // Cursor in the second list item: indent nests it under the first.
    let pos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.isText && n.text === 'two') pos = p + 1;
    });
    editor.commands.setTextSelection(pos);
    editor.commands.indent();
    expect(findAll(editor.getJSON(), 'bulletList')).toHaveLength(2);
  });

  it('inserts a table that serializes as an email table', () => {
    const { editor } = makeEditor('<p></p>');
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    editor.commands.insertContent('Name'); // the cursor starts in the first header cell
    const { html, text } = serializeEmail(editor.getJSON());
    expect(html).toContain('<table cellpadding="6" cellspacing="0" border="1"');
    expect(html.match(/<th /g)).toHaveLength(2);
    expect(html.match(/<td /g)).toHaveLength(2);
    expect(html).toContain('font-weight:bold">Name</th>');
    expect(text.startsWith('Name |\n----')).toBe(true);
  });

  it('accepts extra extensions', () => {
    const { editor } = makeEditor('', { extra: [] });
    expect(editor.extensionManager.extensions.some((e) => e.name === 'composerShortcuts')).toBe(true);
  });

  it('renders direction as dir="auto" until it is set', () => {
    const { editor } = makeEditor('<p>Hello</p>');
    expect(editor.getHTML()).toContain('<p dir="auto">Hello</p>');
    editor.commands.selectAll();
    editor.commands.setDirection('rtl');
    expect(editor.getHTML()).toContain('<p dir="rtl">Hello</p>');
  });
});

describe('signature block', () => {
  it('keeps exactly one signature, always last, and swaps it on change', () => {
    const { editor } = makeEditor('<p>Hi</p>');
    editor.commands.setSignature('sig-en');
    editor.commands.setSignature('sig-ar');
    const sigs = findAll(editor.getJSON(), 'emailSignature');
    expect(sigs).toHaveLength(1);
    expect(sigs[0].attrs.signatureId).toBe('sig-ar');
    expect(editor.getJSON().content!.at(-1)!.type).toBe('emailSignature');
    editor.commands.setSignature(null);
    expect(findAll(editor.getJSON(), 'emailSignature')).toHaveLength(0);
  });

  it('shows a plain-text preview, never HTML', () => {
    const { editor } = makeEditor('<p>Hi</p>');
    editor.commands.setSignature('<img src=x onerror=alert(1)>');
    const dom = editor.view.dom.querySelector('.fx-signature')!;
    expect(dom.querySelector('img')).toBeNull();
    expect(dom.textContent).toContain('preview of <img');
  });
});

describe('typed content to email', () => {
  it('serializes formatting made through editor commands', () => {
    const { editor } = makeEditor('<p>Hello world</p>');
    editor.chain().selectAll().toggleBold().setColor('#188038').setTextAlign('center').run();
    const { html, text } = serializeEmail(editor.getJSON());
    // Mark nesting follows schema order (textStyle before bold); both orders are valid email HTML.
    expect(html).toContain('<div style="margin:0;text-align:center" align="center"><span style="color:#188038"><strong>Hello world</strong></span></div>');
    expect(text).toBe('Hello world\n');
  });
});
