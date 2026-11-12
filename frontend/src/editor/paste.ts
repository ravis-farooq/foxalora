import { safeHref } from './allowlist';

/**
 * Cleans clipboard HTML before ProseMirror parses it (editorProps.transformPastedHTML).
 * The restricted schema already drops anything it has no rule for; this step removes
 * Word and Google Docs noise, rebuilds Word's fake lists as real lists, and turns
 * pasted data: images into local attachments. It is not a security boundary: the
 * server sanitizes the final HTML again.
 */

export interface PasteOptions {
  /** Stores a pasted data: image and returns its preview URL and content id. */
  registerImage?: (dataUrl: string) => { contentId: string; previewUrl: string } | null;
}

const DROP_TAGS = [
  'script', 'style', 'meta', 'link', 'title', 'xml', 'iframe', 'frame', 'object', 'embed',
  'form', 'input', 'button', 'select', 'textarea', 'svg', 'math', 'video', 'audio',
  'noscript', 'template', 'head',
];

/** CSS properties kept on paste. Fonts and sizes are dropped so pasted text takes the
 * message's default font, like most webmail clients do. */
const KEEP_STYLE = new Set(['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-align', 'color', 'background-color']);
const NEUTRAL_COLOR = /^(windowtext|black|auto|inherit|initial|#000|#000000|rgb\(0,\s*0,\s*0\))$/i;
const NEUTRAL_BACKGROUND = /^(transparent|white|window|auto|inherit|initial|none|#fff|#ffffff|rgb\(255,\s*255,\s*255\)|rgba\(0,\s*0,\s*0,\s*0\))$/i;

const KEEP_ATTRS: Record<string, string[]> = {
  a: ['href'],
  img: ['src', 'alt', 'width', 'height', 'data-content-id'],
  ol: ['start'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;

export function cleanPastedHtml(html: string, opts: PasteOptions = {}): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;

  removeComments(body);
  for (const tag of DROP_TAGS) body.querySelectorAll(tag).forEach((el) => el.remove());

  convertWordLists(body);
  // Google Docs puts column widths in <colgroup>; Word puts them on cells. Neither is kept.
  body.querySelectorAll('colgroup').forEach((el) => el.remove());
  // Word's <o:p> placeholders; Google Docs' <b id="docs-internal-guid-..."> wrapper.
  [...body.getElementsByTagName('*')]
    .filter((el) => el.localName === 'o:p' || (el.localName === 'b' && el.id.startsWith('docs-internal-guid')))
    .forEach(unwrap);

  for (const img of [...body.querySelectorAll('img')]) cleanImage(img, opts);
  for (const el of [...body.querySelectorAll('*')]) cleanAttributes(el);

  return body.innerHTML;
}

function removeComments(root: Node) {
  const walker = root.ownerDocument!.createTreeWalker(root, 128 /* NodeFilter.SHOW_COMMENT */);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((c) => c.parentNode?.removeChild(c));
}

function unwrap(el: Element) {
  el.replaceWith(...el.childNodes);
}

function cleanImage(img: HTMLImageElement, opts: PasteOptions) {
  const src = img.getAttribute('src') ?? '';
  const stored = DATA_IMAGE.test(src) && opts.registerImage ? opts.registerImage(src) : null;
  if (!stored) {
    // Remote, file:// (Word) or unsupported images are not pasted: the editor never
    // loads remote content, and file:// paths are unreadable from the browser.
    img.remove();
    return;
  }
  img.setAttribute('src', stored.previewUrl);
  img.setAttribute('data-content-id', stored.contentId);
}

function cleanAttributes(el: Element) {
  const tag = el.localName;
  const keep = KEEP_ATTRS[tag] ?? [];
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (name === 'style') {
      const style = filterStyle(attr.value);
      if (style) el.setAttribute('style', style);
      else el.removeAttribute('style');
    } else if (name === 'dir') {
      // Google Docs marks every paragraph dir="ltr"; keep only explicit rtl so
      // automatic direction still works for mixed-language text.
      if (attr.value.toLowerCase() !== 'rtl') el.removeAttribute('dir');
    } else if (!keep.includes(name)) {
      el.removeAttribute(attr.name);
    }
  }
  if (tag === 'a') {
    const href = safeHref(el.getAttribute('href'));
    if (href) el.setAttribute('href', href);
    else unwrap(el);
  }
}

function filterStyle(style: string): string {
  return style
    .split(';')
    .map((d) => d.split(':'))
    .filter(([p, v]) => p && v !== undefined)
    .map(([p, ...v]) => [p.trim().toLowerCase(), v.join(':').trim()] as const)
    // Word writes highlights as the `background` shorthand with a plain colour.
    .map(([p, v]) => (p === 'background' && /^(#[0-9a-f]{3,6}|[a-z]{3,20})$/i.test(v) ? (['background-color', v] as const) : ([p, v] as const)))
    .filter(
      ([p, v]) =>
        KEEP_STYLE.has(p) &&
        !(p === 'color' && NEUTRAL_COLOR.test(v)) &&
        !(p === 'background-color' && NEUTRAL_BACKGROUND.test(v)),
    )
    .map(([p, v]) => `${p}:${v}`)
    .join(';');
}

// ---------- Word lists ----------
// Word writes lists as <p class="MsoListParagraph" style="mso-list:l0 level2 lfo1">
// with the bullet or number as text inside <span style="mso-list:Ignore">.

function isWordListPara(el: Element): boolean {
  return (
    el.localName === 'p' &&
    (/MsoListParagraph/i.test(el.getAttribute('class') ?? '') || /mso-list:\s*l\d+/i.test(el.getAttribute('style') ?? ''))
  );
}

function convertWordLists(root: Element) {
  const parents = new Set<Element>();
  root.querySelectorAll('p').forEach((p) => isWordListPara(p) && p.parentElement && parents.add(p.parentElement));
  for (const parent of parents) {
    let run: Element[] = [];
    for (const child of [...parent.children]) {
      if (isWordListPara(child)) run.push(child);
      else if (run.length) {
        buildList(run);
        run = [];
      }
    }
    if (run.length) buildList(run);
  }
}

function buildList(paras: Element[]) {
  const doc = paras[0].ownerDocument;
  const frag = doc.createDocumentFragment();
  const stack: { level: number; list: Element }[] = [];

  for (const p of paras) {
    const level = Number(/level(\d+)/i.exec(p.getAttribute('style') ?? '')?.[1] ?? 1);
    const markers = [...p.querySelectorAll('span')].filter((s) => /mso-list:\s*ignore/i.test(s.getAttribute('style') ?? ''));
    const markerText = markers.map((m) => m.textContent ?? '').join('').trim();
    markers.forEach((m) => m.remove());
    const ordered = /^([0-9]+|[a-z]|[ivxlcdm]+)[.)]/i.test(markerText);

    while (stack.length && stack[stack.length - 1].level > level) stack.pop();
    if (!stack.length || stack[stack.length - 1].level < level) {
      const list = doc.createElement(ordered ? 'ol' : 'ul');
      const top = stack[stack.length - 1];
      const host = top?.list.lastElementChild;
      if (host) host.appendChild(list);
      else frag.appendChild(list);
      stack.push({ level, list });
    }
    const li = doc.createElement('li');
    const para = doc.createElement('p');
    para.append(...p.childNodes);
    li.appendChild(para);
    stack[stack.length - 1].list.appendChild(li);
  }

  paras[0].replaceWith(frag);
  paras.slice(1).forEach((p) => p.remove());
}
