import { Node } from '@tiptap/core';
import { linkTarget } from '../src/composer/LinkDialog';
import { linkTextMismatch } from '../src/linkcheck';
import { serializeEmail } from '../src/serialize';
import { makeEditor } from './helpers';

describe('link dialog address handling', () => {
  it('turns email addresses into mailto: and adds https to bare hosts', () => {
    expect(linkTarget('name@example.com')).toBe('mailto:name@example.com');
    expect(linkTarget('mailto:name@example.com')).toBe('mailto:name@example.com');
    expect(linkTarget('example.com/x')).toBe('https://example.com/x');
    expect(linkTarget(' https://ok.example/ ')).toBe('https://ok.example/');
  });

  it('refuses unsafe schemes and junk', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x', 'has space.com', ''])
      expect(linkTarget(bad)).toBeNull();
  });
});

describe('link text mismatch warning', () => {
  it('flags text that shows one address but links to another', () => {
    expect(linkTextMismatch('paypal.com', 'https://evil.example/login')).toBe(true);
    expect(linkTextMismatch('https://bank.example', 'https://bank.example.evil.test/')).toBe(true);
    expect(linkTextMismatch('help@bank.example', 'mailto:help@evil.example')).toBe(true);
  });

  it('does not flag matching hosts or ordinary link text', () => {
    expect(linkTextMismatch('www.example.com', 'https://example.com/page')).toBe(false);
    expect(linkTextMismatch('Read the plan', 'https://evil.example/')).toBe(false);
    expect(linkTextMismatch('a@b.example', 'mailto:a@b.example')).toBe(false);
  });
});

describe('formatting output', () => {
  it('writes highlight colours and paragraph indent, mirrored for right-to-left', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { indent: 2 }, content: [{ type: 'text', text: 'hi', marks: [{ type: 'textStyle', attrs: { backgroundColor: '#fef7e0' } }] }] },
        { type: 'paragraph', attrs: { indent: 1 }, content: [{ type: 'text', text: 'مرحبا' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { backgroundColor: 'url(https://t.example/p)' } }] }] },
      ],
    };
    const { html, text } = serializeEmail(doc);
    expect(html).toContain('<div style="margin:0;margin-left:80px"><span style="background-color:#fef7e0">hi</span></div>');
    expect(html).toContain('<div style="margin:0;margin-right:40px;text-align:right" align="right" dir="rtl">مرحبا</div>');
    expect(html).not.toContain('url(');
    expect(text).toBe('        hi\n    مرحبا\nx\n');
  });
});

describe('extensibility', () => {
  // A host app adds its own block type and tells the serializer how to send it.
  const Callout = Node.create({
    name: 'callout',
    group: 'block',
    content: 'inline*',
    parseHTML: () => [{ tag: 'div[data-callout]' }],
    renderHTML: () => ['div', { 'data-callout': '' }, 0],
  });

  it('serializes a custom node through SerializeContext.nodes, with escaping still applied', () => {
    const { editor } = makeEditor('<div data-callout>Office closed <b>Friday</b> & Monday</div>', { extra: [Callout] });
    const { html, text } = serializeEmail(editor.getJSON(), {
      nodes: {
        callout: {
          html: (n, w) => `<div style="background:#fef7e0;padding:8px;border-radius:4px">${w.inline(n.content)}</div>`,
          text: (n, w) => [`! ${w.textInline(n.content)}`],
        },
      },
    });
    expect(html).toContain('<div style="background:#fef7e0;padding:8px;border-radius:4px">Office closed <strong>Friday</strong> &amp; Monday</div>');
    expect(text).toBe('! Office closed Friday & Monday\n');
  });

  it('keeps the text of an unknown custom node when no serializer is given', () => {
    const { editor } = makeEditor('<div data-callout>Note <b>this</b></div>', { extra: [Callout] });
    const { html, text } = serializeEmail(editor.getJSON());
    expect(text).toBe('Note this\n');
    expect(html).toContain('<div style="margin:0">Note <strong>this</strong></div>');
  });
});
