# Spike: Tiptap made email-specific (FOX-051)

Throwaway spike, not production code. Results: `../../docs/EDITOR_SPIKE_TIPTAP.md`. Decision: `../../docs/DECISIONS.md` D-003.

```bash
npm install
npm test          # 44 tests: serializer, paste samples, editor, links, extensibility
npm run typecheck
npm run dev       # demo page on http://localhost:5180
```

`src/composer/EmailComposer.tsx` is the reusable component (Gmail-style toolbar, bubble menus, link dialog, tables, images). `src/Demo.tsx` shows how a host page uses it, including a custom toolbar button.

`src/samples/*.html` are hand-written approximations of Word, Google Docs and Excel clipboard HTML. Replace them with real captures before closing FOX-051.
