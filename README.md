# VoxNote

> Your voice, in the margins.

An open-source, AI-native PDF reviewer for iPad and the browser. Highlight,
comment and suggest on a paper by voice — the PDF itself is never edited.

**Status:** early scaffold (milestone M0). The name is a working name pending
availability and trademark checks. See [ROADMAP.md](ROADMAP.md).

## What works today

- Open a local PDF (file picker or drag-and-drop) and read it with a
  selectable text layer, rendered by pdf.js.
- Highlight text (select, then tap **Highlight**) or a region (**Region**
  tool, then drag over a figure).
- Highlights are stored locally in your browser (IndexedDB) and come back
  when you reopen the same file.
- **Export PDF** downloads a copy with native PDF highlight annotations. The
  original file is never modified.

## Run it

```bash
npm install
npm run dev
```

Then open the printed URL. To try it on an iPad on the same network, run
`npm run dev -- --host` and open the LAN address in Safari.

## Develop

```bash
npm test           # unit tests (Vitest)
npm run lint       # oxlint
npm run format     # Prettier
npm run build      # typecheck + production build
```

Contributions follow [CONTRIBUTING.md](CONTRIBUTING.md); agents follow
[AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE).
