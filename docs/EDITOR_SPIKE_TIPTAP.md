# Editor spike results: Tiptap made email-specific (FOX-051)

Date: 2026-11-12. Decision context: `docs/DECISIONS.md` D-003. Code: `spikes/tiptap-email/`.

## Verdict

**Tiptap works for Foxalora's composer. Continue with it; the Squire fallback is not needed so far.** Every part the spike set out to build works and is covered by automated tests. The open risks are about real email clients and real devices, which this Mac setup could not test (section 5).

## 1. What was built

| File | Purpose |
| --- | --- |
| `src/extensions.ts` | Restricted schema: StarterKit without code/code block, headings 1-3, links limited to http/https/mailto/tel, text colour/font/size, alignment, plus three custom pieces: per-paragraph **direction** (`dir`), **inline image** that only accepts local `blob:` previews with a content id, and an atomic **signature block** that holds only a reference and cannot be created by pasting |
| `src/serialize.ts` | Builds what is sent from the editor's JSON (no DOM needed, so it also runs on the server): email-safe HTML with inline styles, `align` and `dir` attributes, `cid:` images, signature merged in, quoted original appended; and a plain-text part with `text <url>` links, list markers, `> ` quoting and the `-- ` signature separator |
| `src/allowlist.ts` | The only fonts, sizes, colours, link schemes and image types that may reach the wire |
| `src/paste.ts` | Cleans pasted HTML: removes Office and Google Docs markup, rebuilds Word's fake lists as real nested lists, unwraps the Google Docs wrapper, keeps bold/italic/underline/colour/alignment, drops fonts and layout CSS, keeps only `rtl` direction, turns pasted `data:` images into attachments, drops remote and `file://` images |
| `src/images.ts` | Holds inline images until send (type and 5 MB size check, random `…@foxalora` content ids) |
| `src/Composer.tsx` | Demo page with toolbar, signature picker, reply mode, paste-sample buttons and three output views |
| `tests/` | 44 tests: serializer, paste samples (Word, Google Docs, Excel, hostile), editor behaviour, link handling, extensibility |
| `src/composer/` | The `<EmailComposer>` React component: Gmail-style toolbar, menus, link dialog (section 8) |

## 2. What was run

| Check | Result |
| --- | --- |
| `npm test` (Vitest + jsdom, real ProseMirror paste path) | **30 passed** |
| `npm run typecheck` (TypeScript 7.0.2, strict) | **Passed** |
| `npm run build` (Vite 8) | **Passed** |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| Runtime dependency licences | **60 packages, all MIT** |
| Browser (Chromium in the Claude desktop browser pane) | Typing, bold shortcut, Arabic typing, auto-link while typing, signature swap, reply mode, all three paste samples through the real browser paste path, sandboxed email preview, 375 px width emulation. No console errors |

## 3. Results against the spike goals

| Goal | Result | Notes |
| --- | --- | --- |
| Allow only email-safe content | ✅ | No code, code block or table nodes; unknown pasted elements become plain paragraphs, their text kept |
| Email-safe HTML | ✅ structure | Inline styles everywhere, legacy `align` attribute, Gmail-style one `<div>` per line, `<br>` for blank lines, list indentation by inline margin. **Not yet checked in Outlook, Gmail or Apple Mail** |
| Plain-text part | ✅ | Built from the same document data, not by stripping HTML |
| Signature block | ✅ | One per message, always last, swapped on change, preview shown as plain text only (`textContent`) |
| Quoted original in replies | ✅ | Kept outside the editor and appended at send as `<blockquote type="cite">`; cannot be damaged by typing |
| Inline images | ✅ | Shown as `blob:` previews, sent as `cid:`; images the composer did not create are dropped on output |
| Paste from Word | ✅ on hand-written sample | Nested bullets, numbered list, bold, italic, colour, link kept; glyphs, `mso-` styles, `<o:p>`, Calibri and `file://` images removed |
| Paste from Google Docs | ✅ on hand-written sample | Wrapper unwrapped without bolding everything; italic, underline, list, link, Arabic line and image kept |
| Hostile paste | ✅ | Scripts, frames, forms, SVG, event handlers, `javascript:`/`data:` links, tracking images, layout CSS and forged signature or image ids all removed |
| Right-to-left | ✅ | `dir="auto"` while typing (Arabic aligns right on its own), manual LTR/RTL/Auto buttons, `dir="rtl"` plus right alignment in sent HTML, mirrored list and quote indentation |

## 4. Problems found and fixed during the spike

1. **Pasted tables were squashed** ("cell onecell two"). First fixed by flattening rows; in the second iteration a real table node was added (section 8).
2. **Blank lines at the end** of pasted Word content were sent. Now trimmed before the signature.
3. **Non-breaking spaces** stayed at line ends in plain text. Now trimmed.
4. **Signature preview ran onto one line**: ProseMirror's stylesheet sets `white-space: normal` on locked blocks. Fixed with a more specific rule.
5. **Inline images broke in the sandboxed preview.** A sandboxed frame has an opaque origin, which cannot load the page's `blob:` URLs. The preview now uses `data:` URLs. **The same limit applies to the separate render domain (FOX-045):** inline images in received mail must be served from that domain, not passed as `blob:` links.

## 5. Not tested yet (open risks)

| Risk | Why it matters | How to close it |
| --- | --- | --- |
| Rendering in Outlook desktop, Outlook.com, Gmail, Apple Mail, mobile clients | Email HTML support varies widely; Outlook desktop uses Word's renderer | Send test messages to real accounts, or use an email rendering service, before the composer ships |
| **Real** Word and Google Docs clipboard HTML | The samples in `src/samples/` are hand-written approximations, not captures | Capture clipboard HTML from Word (Windows and Mac), Google Docs (Chrome and Safari), Outlook web, LibreOffice and Apple Pages; add each as a test fixture |
| Android keyboards (predictive text, composition) | ProseMirror has known edge cases with some Android keyboards | Test on real Android devices with Gboard and Samsung Keyboard |
| iOS Safari | Selection, toolbar and keyboard behaviour differ | Test on a real iPhone or the iOS Simulator |
| Screen readers | Toolbar needs proper toolbar semantics and keyboard navigation | Test with VoiceOver and NVDA during FOX-107 |
| Images pasted as files and drag-and-drop | Code is in place but browser automation could not supply real files | Manual test |
| Auto-link on bulk-inserted text | Tiptap checks only the word before each space, so dictation or text inserted in one chunk is not linked | Also detect links when the message is sent |
| Pasted image type | Taken from the `data:` URL, not checked against the actual bytes | Server checks the real file type on upload (CLAUDE.md rule 11) |

## 6. Size

Measured with two minimal pages built by Vite in production mode:

| Part | Minified | Gzipped |
| --- | --- | --- |
| React + React DOM (shared with the rest of the app) | 220 KB | 68 KB |
| Editor: Tiptap + ProseMirror + spike code | 430 KB | 134 KB |

The editor should be loaded only when the user opens the composer, so the inbox stays fast (NFR-002).

## 7. Recommendations for the composer story (FOX-052 onwards)

1. **Send the editor's JSON to the server, not HTML.** The serializer has no DOM dependency, so the backend can build the outgoing HTML itself from the allowlist. The server then never has to trust client HTML for the typed part; DOMPurify is still run on the quoted original and as a final pass. This also fixes D10 by design.
2. Load the composer lazily.
3. Add a simple table node (Tiptap's table extension is MIT) with an email-safe table serializer, so pasted spreadsheet ranges keep their shape.
4. Compact toolbar on phones; the demo toolbar takes four rows at 375 px.
5. Add link detection at send time for text that was inserted in one chunk.
6. Capture real clipboard samples and add them to the test suite before closing FOX-051.
7. Choice made in the spike, confirm or change: pasted text drops its font family and size and takes the message's default font, as Gmail-style clients usually do. Colour, bold, italic, underline and alignment are kept.

## 8. Composer UI (added 2026-11-12, second iteration)

Built on request: a Gmail-like toolbar, bubble and floating menus, fonts/colours/formatting, links, images and tables, packaged as an extensible React component. Code in `src/composer/`.

| Feature | What exists | Checked in browser |
| --- | --- | --- |
| Gmail-style formatting bar | Undo, redo, font, size (Small/Normal/Large/Huge), bold, italic, underline, text and background colour (two palettes), align menu, numbered and bulleted lists, indent less/more, quote, strikethrough, remove formatting. Toggled by the "A" button in the action row, as in Gmail | Yes |
| Action row | Send, formatting toggle, insert link, insert photo, insert table, signature menu, text direction menu, discard | Yes |
| Bubble menu on selected text | Bold, italic, underline, strikethrough, colour, link, remove formatting | Yes |
| Link menu | Shows the real address, open, change, remove, and **warns when the text shows a different address** (`src/linkcheck.ts`, reusable for FOX-047) | Yes |
| Link dialog | Gmail's "Text to display" + address; email addresses become `mailto:`; unsafe schemes refused with a message; ⌘/Ctrl+K | Yes |
| Tables | Insert from the action row or "+" menu; bubble menu for rows, columns, header row, delete; pasted Word, Google Docs and Excel tables kept as real tables; sent with `border`/`cellpadding` attributes and inline cell styles | Yes |
| Images | Insert from file, paste or drop as `cid:` attachments; resize handles; image menu with Small / Best fit / Original size / Remove | Menu: no (needs a real file) |
| Floating "+" menu | On empty lines: bulleted list, numbered list, quote, table, image, divider | Yes |
| Fonts, sizes, colours | Gmail font list mapped to email-safe stacks; highlight colour; Word highlights kept on paste | Yes |
| Indent | Lists nest; other paragraphs indent in 40 px steps (max 4), mirrored for right-to-left; ⌘/Ctrl+[ and ] | Tests |
| Keyboard and screen readers | `role="toolbar"` with one Tab stop and arrow-key movement; menus open with focus inside when opened from the keyboard, arrow keys move, Escape returns focus; every control has an accessible name and a tooltip with its shortcut | Yes (keyboard); screen reader not tested |
| Phones | Formatting bar is one row that scrolls sideways; popovers are fixed-positioned so they are not clipped | 375 px emulation |
| Extensibility | `<EmailComposer>` props: `toolbar` (built-in ids, separators, custom items), `extensions` (extra Tiptap extensions), `nodeSerializers` (email output for custom nodes), `signatures`, `quoted`, `images`, `onChange`, `onSend`, `onDiscard`, `onReady`. The demo adds an "Insert today's date" button this way; a test adds a custom "callout" block with its own email output | Yes / tests |

**Bugs found and fixed while testing the UI**
1. Menus re-rendered endlessly: `shouldShow`/`options` objects were recreated every render, so Tiptap re-registered the menus on each transaction. They are now module-level constants (commented in `Menus.tsx`).
2. Vite re-bundled dependencies mid-session and loaded two copies of React. Tiptap entry points are now listed in `optimizeDeps.include`.
3. After choosing a menu option, focus jumped back to the toolbar button, and the cursor could land after a new table instead of in its first cell. Mouse-opened menus now leave focus in the editor; only keyboard-opened menus move focus into the panel.
4. The default signature could be removed by the first Undo. It is now inserted outside the undo history.
5. Keyboard users could not Tab into the toolbar when its first button (Undo) was disabled. The Tab stop now skips disabled buttons.
6. Unknown custom blocks without a serializer lost their text. They are now sent as plain lines.

**Size with the full UI:** editor and composer 546 KB minified, **168 KB gzipped** (plus 2 KB CSS), on top of React's 68 KB. Still a reason to load the composer only when it is opened.

**Still not done:** dark theme for the composer, a real table-size picker grid, emoji, attachments (non-image files, FOX-061/062), and screen-reader testing.

## 9. Moved into the app (2026-11-12)

The editor is now the real composer: `frontend/src/editor/` (canonical copy; `spikes/` is kept as the record of the spike) with its 44 tests in `frontend/tests/editor/`. The compose window (`frontend/src/components/Compose.tsx`) adds To / Cc / Bcc / Subject above the unchanged editor, sends the editor's HTML and plain text, and replies carry the original as the separate quoted block.
- **Inline images on send:** the backend now accepts them (`backend/src/mail/inline-images.ts`): max 10 images, 5 MB each, 10 MB total, PNG/JPEG/GIF/WebP checked by magic bytes against the declared type, only images referenced as `cid:` attached inline; the send route alone accepts 15 MB bodies. Verified end to end on GreenMail and Exim + Dovecot (multipart/related with Content-ID).
- **Found while testing:** GreenMail answers `BODY[part.MIME]` for parts nested in multipart/related with the parent's headers, so the HTML part was not decoded. The backend now decodes from BODYSTRUCTURE when the server's answer does not match the requested part (`backend/src/mail/decode-part.ts`).
- **Differences from the demo page:** the demo's sample signatures ("Sam Lee") are not shown because signatures are not stored yet (FOX-057/079); the signature button appears once a user has signatures. The writing area no longer shows a focus outline (matches Gmail and the screenshot used as reference).

## 10. Dependencies added (spike only)

All versions pinned, each published at least two weeks before 2026-11-12:
`@tiptap/*` 3.32.1 including `@tiptap/extension-table` and `@tiptap/extensions`, `react`/`react-dom` 19.3.1 (61 runtime packages, all MIT, `npm audit` clean); dev: `vite` 8.3.5, `@vitejs/plugin-react` 6.1.2, `vitest` 4.1.12, `jsdom` 30.1.3, `typescript` 7.0.2, `@types/*`.
npm 10.9.9 crashes while resolving optional peers of `@vitejs/plugin-react` ("reading 'edgesOut'"), so the spike has an `.npmrc` with `legacy-peer-deps=true`. All required peers are listed explicitly in `package.json`.
