import { serializeEmail } from '../../src/editor/serialize';

const p = (text: string, attrs: object = {}, marks: object[] = []) => ({
  type: 'paragraph',
  attrs,
  content: text ? [{ type: 'text', text, marks }] : [],
});
const doc = (...content: object[]) => ({ type: 'doc', content });
const body = (html: string) => /<div style="font-family[^>]*>(.*)<\/div><\/body>/s.exec(html)![1];

describe('email HTML', () => {
  it('writes Gmail-style line divs, <br> for empty lines and a full document', () => {
    const { html } = serializeEmail(doc(p('Hello'), p(''), p('Bye')));
    expect(html.startsWith('<!DOCTYPE html><html><head><meta charset="utf-8">')).toBe(true);
    expect(body(html)).toBe('<div style="margin:0">Hello</div><div style="margin:0"><br></div><div style="margin:0">Bye</div>');
  });

  it('escapes text and attribute values', () => {
    const { html } = serializeEmail(doc(p('<script>alert("x")</script> & co')));
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co');
    expect(html).not.toContain('<script>');
  });

  it('maps marks to simple tags and keeps only allowed styles', () => {
    const { html } = serializeEmail(
      doc(
        p('x', {}, [
          { type: 'bold' },
          { type: 'italic' },
          { type: 'underline' },
          { type: 'strike' },
          { type: 'textStyle', attrs: { color: '#d93025', fontFamily: 'Georgia', fontSize: '20px' } },
        ]),
        p('y', {}, [{ type: 'textStyle', attrs: { color: 'red;background:url(x)', fontFamily: 'Comic Sans MS', fontSize: '99px' } }]),
      ),
    );
    expect(html).toContain('<strong><em><u><s><span style="color:#d93025;font-family:Georgia, serif;font-size:20px">x</span></s></u></em></strong>');
    expect(html).toContain('<div style="margin:0">y</div>');
  });

  it('drops unsafe links and adds https to bare hosts', () => {
    const link = (href: string) => p('t', {}, [{ type: 'link', attrs: { href } }]);
    const { html } = serializeEmail(doc(link('javascript:alert(1)'), link('data:text/html,x'), link('example.com/a'), link('mailto:a@b.com')));
    expect(html).not.toMatch(/javascript:|data:text/);
    expect(html).toContain('<a href="https://example.com/a" style="color:#1a73e8;text-decoration:underline">t</a>');
    expect(html).toContain('href="mailto:a@b.com"');
  });

  it('writes alignment as CSS and the legacy align attribute', () => {
    const { html } = serializeEmail(doc(p('c', { textAlign: 'center' }), p('l', { textAlign: 'left' })));
    expect(html).toContain('<div style="margin:0;text-align:center" align="center">c</div>');
    expect(html).toContain('<div style="margin:0">l</div>');
  });

  it('detects Arabic and writes dir="rtl" with right alignment', () => {
    const { html } = serializeEmail(doc(p('مرحبا بكم'), p('Hello'), p('Hi', { dir: 'rtl' })));
    expect(html).toContain('<div style="margin:0;text-align:right" align="right" dir="rtl">مرحبا بكم</div>');
    expect(html).toContain('<div style="margin:0">Hello</div>');
    expect(html).toContain('dir="rtl">Hi</div>');
  });

  it('mirrors list indentation for right-to-left lists', () => {
    const list = (dir?: string) => ({
      type: 'bulletList',
      attrs: dir ? { dir } : {},
      content: [{ type: 'listItem', content: [p('عنصر')] }],
    });
    const { html } = serializeEmail(doc(list()));
    expect(html).toContain('<ul style="margin:0 28px 0 0;padding:0" dir="rtl"><li style="margin:0">عنصر</li></ul>');
  });

  it('writes lists with inline-styled indentation, start numbers and nesting', () => {
    const { html, text } = serializeEmail(
      doc({
        type: 'orderedList',
        attrs: { start: 3 },
        content: [
          {
            type: 'listItem',
            content: [p('three'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('sub')] }] }],
          },
          { type: 'listItem', content: [p('four')] },
        ],
      }),
    );
    expect(html).toContain('<ol start="3" style="margin:0 0 0 28px;padding:0"><li style="margin:0">three<ul style="margin:0 0 0 28px;padding:0"><li style="margin:0">sub</li></ul></li><li style="margin:0">four</li></ol>');
    expect(text).toBe('3. three\n   - sub\n4. four\n');
  });

  it('turns inline images into cid: references and reports their content ids', () => {
    const img = { type: 'image', attrs: { src: 'blob:x', contentId: 'abc@foxalora', alt: 'Logo', width: 120 } };
    const out = serializeEmail(doc({ type: 'paragraph', content: [img] }));
    expect(out.html).toContain('<img src="cid:abc@foxalora" alt="Logo" width="120" style="max-width:100%;height:auto;border:0;display:inline-block">');
    expect(out.html).not.toContain('blob:');
    expect(out.contentIds).toEqual(['abc@foxalora']);
    expect(out.text).toBe('[image: Logo]\n');
  });

  it('drops images the composer did not create', () => {
    const img = { type: 'image', attrs: { src: 'blob:x', contentId: 'forged@x' } };
    const out = serializeEmail(doc({ type: 'paragraph', content: [img] }), { isKnownImage: () => false });
    expect(out.html).not.toContain('cid:');
    expect(out.contentIds).toEqual([]);
  });

  it('merges the signature and appends the quoted original after it', () => {
    const out = serializeEmail(doc(p('Thanks'), { type: 'emailSignature', attrs: { signatureId: 's1' } }), {
      signatures: { s1: doc(p('Sam Lee'), p('Example Hosting')) as any },
      quoted: { header: 'On Mon, Alice <alice@example.com> wrote:', html: '<p>Original</p>', text: 'Original\n\nline 2' },
    });
    expect(out.html).toContain('<div style="margin:12px 0 0 0"><div style="margin:0">Sam Lee</div><div style="margin:0">Example Hosting</div></div>');
    expect(out.html).toContain('On Mon, Alice &lt;alice@example.com&gt; wrote:</div><blockquote type="cite"');
    expect(out.text).toBe('Thanks\n\n-- \nSam Lee\nExample Hosting\n\nOn Mon, Alice <alice@example.com> wrote:\n> Original\n>\n> line 2\n');
  });

  it('keeps the lines of a multi-line header (forwarded message) and escapes them', () => {
    const out = serializeEmail(doc(p('FYI')), {
      quoted: { header: '---------- Forwarded message ---------\nFrom: Dave <dave@x.test>\nSubject: <b>Hi</b>', html: '<p>Body</p>', text: 'Body' },
    });
    expect(out.html).toContain('---------- Forwarded message ---------<br>From: Dave &lt;dave@x.test&gt;<br>Subject: &lt;b&gt;Hi&lt;/b&gt;</div>');
    expect(out.text).toContain('\n---------- Forwarded message ---------\nFrom: Dave <dave@x.test>\nSubject: <b>Hi</b>\n> Body\n');
  });
});

describe('plain text', () => {
  it('shows links as "text <url>" unless the text is the url', () => {
    const { text } = serializeEmail(
      doc(
        { type: 'paragraph', content: [
          { type: 'text', text: 'See ' },
          { type: 'text', text: 'the ', marks: [{ type: 'link', attrs: { href: 'https://x.example/' } }] },
          { type: 'text', text: 'plan', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://x.example/' } }] },
          { type: 'text', text: ' or mail ' },
          { type: 'text', text: 'a@b.com', marks: [{ type: 'link', attrs: { href: 'mailto:a@b.com' } }] },
        ] },
      ),
    );
    expect(text).toBe('See the plan <https://x.example/> or mail a@b.com\n');
  });

  it('quotes blockquotes and keeps hard breaks', () => {
    const { text } = serializeEmail(
      doc({ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] }),
    );
    expect(text).toBe('> a\n> b\n');
  });
});
