import { describe, expect, it } from 'vitest';
import { ImageStore } from '../../src/editor/images';
import { serializeEmail } from '../../src/editor/serialize';
import { countImages, withInlineSignatureImages } from '../../src/editor/signature-images';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const sigDoc = (...nodes: object[]) => ({ type: 'doc', content: [{ type: 'paragraph', content: nodes }] });

describe('signature images in a message', () => {
  it('turns stored data-URI images into inline images the message sends as cid attachments', () => {
    let n = 0;
    const store = new ImageStore(() => `blob:preview-${++n}`);
    const sigs = withInlineSignatureImages({ s1: { label: 'Work', content: sigDoc({ type: 'image', attrs: { src: PNG, alt: 'Logo', width: 80 } }, { type: 'text', text: ' Carol' }) } }, store);
    const img = sigs.s1.content.content![0].content![0];
    expect(img.attrs).toMatchObject({ src: 'blob:preview-1', alt: 'Logo', width: 80 });
    const cid = img.attrs!.contentId as string;
    expect(store.get(cid)?.name).toBe('Logo.png');
    expect(store.get(cid)?.blob.type).toBe('image/png');

    const out = serializeEmail(
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }, { type: 'emailSignature', attrs: { signatureId: 's1' } }] },
      { signatures: { s1: sigs.s1.content }, isKnownImage: (id) => !!store.get(id) },
    );
    expect(out.html).toContain(`<img src="cid:${cid}" alt="Logo" width="80"`);
    expect(out.contentIds).toEqual([cid]);
  });

  it('leaves out images that are not data URIs or not allowed', () => {
    const store = new ImageStore(() => 'blob:x');
    const sigs = withInlineSignatureImages({ s1: { label: 'A', content: sigDoc({ type: 'image', attrs: { src: 'https://tracker.example/p.png' } }, { type: 'image', attrs: { src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } }, { type: 'text', text: 'x' }) } }, store);
    expect(countImages(sigs.s1.content)).toBe(0);
  });
});
