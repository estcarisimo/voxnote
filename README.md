# VoxNote

> Your voice, in the margins.

An open-source, AI-native PDF reviewer for iPad and the browser. Highlight,
comment and suggest on a paper by voice — the PDF itself is never edited.

**Status:** early scaffold (milestone M0). The name is a working name pending
availability and trademark checks. See [ROADMAP.md](ROADMAP.md).

## What works today

- Open a local PDF (file picker or drag-and-drop) and read it with a
  selectable text layer, rendered by pdf.js.
- Select text, or drag a region over a figure with the **Region** tool, then
  tap **Highlight**, **Comment** (typed) or **Voice** (recorded with the
  microphone; stays on this device until you choose to transcribe it).
- **Transcribe…** sends a recording to OpenAI with your own API key, after a
  consent dialog that says exactly what is sent and where. Add the key under
  **Providers**; it is encrypted at rest in your browser and never goes
  anywhere but the provider. The raw transcript is kept verbatim.
- Annotations are stored locally in your browser (IndexedDB), recordings
  included, and come back when you reopen the same file. Comment bodies can
  be edited in the **Annotations** panel.
- **Export PDF** downloads a copy with native PDF annotations; comment text
  goes into the note. The original file is never modified.

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
