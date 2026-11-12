import { serializeEmail } from '../../src/editor/serialize';
import { findAll, marksOf, paste, sample } from './helpers';

describe('paste from Word', () => {
  const { json, images } = paste(sample('word.html'));
  const out = serializeEmail(json, { isKnownImage: (id) => !!images.get(id) });

  it('rebuilds bullet and numbered lists, including nesting', () => {
    const bullets = findAll(json, 'bulletList');
    const ordered = findAll(json, 'orderedList');
    expect(ordered).toHaveLength(1);
    expect(bullets).toHaveLength(2); // top level + nested
    expect(out.text).toContain('- First point\n  - Nested detail\n- Second point');
    expect(out.text).toContain('1. Step one\n2. Step two');
  });

  it('removes bullet glyphs, Office markup and fonts but keeps formatting', () => {
    expect(out.html).not.toMatch(/mso-|MsoNormal|o:p|Calibri|·|Symbol/);
    const texts = findAll(json, 'text');
    expect(marksOf(texts.find((t) => t.text === 'Quarterly update'))).toContain('bold');
    expect(marksOf(texts.find((t) => t.text === 'short'))).toContain('italic');
    const red = texts.find((t) => t.text === 'Deadline is Friday.');
    expect(red.marks.find((m: any) => m.type === 'textStyle').attrs.color).toBe('#C00000');
  });

  it('trims blank lines left at the end and non-breaking spaces in plain text', () => {
    expect(out.html).not.toMatch(/<div style="margin:0"><br><\/div><\/div><\/body>/);
    expect(out.text).not.toMatch(/\u00a0/);
    expect(out.text.endsWith('Total 120\n')).toBe(true);
  });

  it('keeps Word highlights as a background colour', () => {
    const t = findAll(json, 'text').find((x) => x.text === 'review by Friday');
    expect(t.marks.find((m: any) => m.type === 'textStyle').attrs.backgroundColor).toBe('yellow');
    expect(out.html).toContain('<span style="background-color:yellow">review by Friday</span>');
  });

  it('keeps the Word table with its merged cell, without Office styling', () => {
    expect(findAll(json, 'table')).toHaveLength(1);
    expect(out.text).toContain('Region | Sales\nNorth | 120\nTotal 120');
    expect(out.html).toMatch(/<td colspan="2" style="border:1px solid #cccccc;padding:6px;vertical-align:top">Total 120<\/td>/);
    expect(out.html).not.toMatch(/MsoTableGrid|windowtext|225\.4pt/);
  });

  it('keeps links and drops file:// images', () => {
    expect(out.html).toContain('<a href="https://intranet.example.com/q3"');
    expect(out.html).not.toContain('file://');
    expect(findAll(json, 'image')).toHaveLength(0);
  });
});

describe('paste from Google Docs', () => {
  const { json, images } = paste(sample('gdocs.html'));
  const out = serializeEmail(json, { isKnownImage: (id) => !!images.get(id) });
  const texts = findAll(json, 'text');

  it('unwraps the docs-internal-guid wrapper without making everything bold', () => {
    expect(marksOf(texts.find((t) => t.text === 'Meeting notes'))).toContain('bold');
    expect(marksOf(texts.find((t) => t.text === 'We agreed on '))).not.toContain('bold');
  });

  it('keeps italic, underline, lists and links', () => {
    expect(marksOf(texts.find((t) => t.text === 'three'))).toContain('italic');
    expect(marksOf(texts.find((t) => t.text === 'priorities'))).toContain('underline');
    expect(out.text).toContain('We agreed on three priorities:');
    expect(out.text).toContain('- Ship the beta\n- Read the plan <https://docs.example.com/plan>');
  });

  it('keeps explicit rtl, drops Google Docs dir="ltr" so auto-detection works', () => {
    const paras = findAll(json, 'paragraph');
    expect(paras.find((p) => p.content?.[0]?.text === 'شكراً للجميع').attrs.dir).toBe('rtl');
    expect(paras.find((p) => p.content?.[0]?.text === 'Meeting notes').attrs.dir).toBeNull();
    expect(out.html).toContain('dir="rtl">شكراً للجميع</div>');
  });

  it('keeps the Google Docs table and its bold header text', () => {
    expect(findAll(json, 'table')).toHaveLength(1);
    expect(out.text).toContain('Owner | Task\nSam | Beta');
    expect(marksOf(texts.find((t) => t.text === 'Owner'))).toContain('bold');
    expect(out.html).not.toMatch(/colgroup|<col /);
  });

  it('turns a pasted data: image into a cid attachment', () => {
    const imgs = findAll(json, 'image');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].attrs.src).toMatch(/^blob:test\//);
    expect(out.contentIds).toEqual([imgs[0].attrs.contentId]);
    expect(out.html).toMatch(/<img src="cid:[0-9a-f-]+@foxalora"/);
    expect(images.get(imgs[0].attrs.contentId)?.blob.type).toBe('image/png');
  });
});

describe('paste from Excel', () => {
  const { json } = paste(sample('excel.html'));
  const out = serializeEmail(json);

  it('keeps the range as a table, without Excel markup', () => {
    expect(findAll(json, 'table')).toHaveLength(1);
    expect(out.text).toBe('Month | Visits | Tickets\nOct | 1200 | 35\nNov | 1350 | 28\n');
    expect(out.html).not.toMatch(/xl65|Calibri|mso-|height=/);
  });
});

describe('hostile paste', () => {
  const { json, images } = paste(sample('hostile.html'));
  const out = serializeEmail(json, { isKnownImage: (id) => !!images.get(id) });

  it('removes scripts, frames, forms, SVG and event handlers', () => {
    expect(out.html).not.toMatch(/<script|<iframe|<form|<input|<svg|onclick|onerror|onload|alert\(/i);
  });

  it('removes dangerous links but keeps the text and safe links', () => {
    expect(out.html).not.toMatch(/javascript:|data:text/);
    expect(out.html).toContain('click me');
    expect(out.html).toContain('<a href="https://ok.example/"');
  });

  it('never keeps remote, SVG, or forged blob images', () => {
    expect(findAll(json, 'image')).toHaveLength(0);
    expect(out.html).not.toMatch(/tracker\.example|evil\.example|<img/);
  });

  it('drops layout CSS, keeps text from unsupported blocks and cannot forge a signature', () => {
    expect(out.html).not.toMatch(/position|background/);
    expect(out.text).toContain('cell one | cell two');
    expect(findAll(json, 'emailSignature')).toHaveLength(0);
  });
});
