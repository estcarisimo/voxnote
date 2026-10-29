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
  tap **Highlight**, **Comment** (typed), **Voice** (recorded with the
  microphone; stays on this device until you choose to transcribe it) or
  **Suggest** (text only: edit the passage as it should read, or dictate
  the replacement). The PDF is never changed.
- **Transcribe…** sends a recording to OpenAI with your own API key, after a
  consent dialog that says exactly what is sent and where. Add the key under
  **Providers**; it is encrypted at rest in your browser (any script running
  on this origin could still use it) and is sent only to the provider, only
  when you confirm. The raw transcript is kept verbatim.
- Annotations are stored locally in your browser (IndexedDB), recordings
  included, and come back when you reopen the same file. Comment bodies can
  be edited in the **Annotations** panel.
- **Export PDF** downloads a copy with native PDF annotations; comment text
  goes into the note. The original file is never modified.
- **Markdown** and **JSON** download a page-by-page review report and a
  machine-readable copy of the annotations (no audio). Nothing is uploaded.
- It can be installed as an app (Add to Home Screen) and reopened without a
  network once loaded; updates wait until you tap **Reload**. Checked in
  desktop Chromium only, not yet tried on an iPad.

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
