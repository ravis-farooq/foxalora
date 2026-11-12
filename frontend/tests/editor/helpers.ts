import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor } from '@tiptap/core';
import { emailExtensions, type EmailExtensionOptions } from '../../src/editor/extensions';
import { ImageStore } from '../../src/editor/images';
import { cleanPastedHtml } from '../../src/editor/paste';

export function sample(name: string): string {
  // vitest runs from the spike root; import.meta.url is not a file URL under jsdom.
  return readFileSync(resolve(process.cwd(), 'tests/editor/samples', name), 'utf8');
}

// jsdom has no ClipboardEvent; ProseMirror's pasteHTML creates one when none is given.
if (typeof (globalThis as any).ClipboardEvent === 'undefined') {
  (globalThis as any).ClipboardEvent = class extends Event {
    clipboardData = null;
  };
}

let n = 0;
export function makeEditor(content: string | object = '', opts: EmailExtensionOptions = {}) {
  const images = new ImageStore(() => `blob:test/${++n}`);
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: emailExtensions({ signaturePreview: (id) => `preview of ${id}`, ...opts }),
    content,
    editorProps: {
      transformPastedHTML: (html) =>
        cleanPastedHtml(html, { registerImage: (d) => images.addDataUrl(d) }),
    },
  });
  return { editor, images };
}

/** Pastes HTML through the real ProseMirror paste path and returns the JSON doc. */
export function paste(html: string) {
  const { editor, images } = makeEditor();
  editor.view.pasteHTML(html);
  return { json: editor.getJSON(), editor, images };
}

/** All nodes of a type anywhere in a JSON doc. */
export function findAll(node: any, type: string, out: any[] = []): any[] {
  if (node.type === type) out.push(node);
  for (const c of node.content ?? []) findAll(c, type, out);
  return out;
}

export function marksOf(node: any): string[] {
  return (node.marks ?? []).map((m: any) => m.type);
}
