# 🎙️ VoxNote

> **Your voice, in the margins.**

An open-source, AI-native PDF reviewer for iPad and the browser. Select a
passage with the Apple Pencil, a finger or the mouse, then highlight it,
comment on it, record a voice note or suggest a rewording — the PDF itself is
never edited. Annotations live beside the document in your browser and are
exported into a copy (annotated PDF, Markdown report or JSON). There is no
backend: VoxNote is a static web app, local-first by default, and audio leaves
the device only when you confirm a transcription with your own provider key.

[![CI](https://github.com/estcarisimo/voxnote/actions/workflows/ci.yml/badge.svg)](https://github.com/estcarisimo/voxnote/actions/workflows/ci.yml)
[![Security](https://github.com/estcarisimo/voxnote/actions/workflows/security.yml/badge.svg)](https://github.com/estcarisimo/voxnote/actions/workflows/security.yml)
[![CodeQL](https://github.com/estcarisimo/voxnote/actions/workflows/codeql.yml/badge.svg)](https://github.com/estcarisimo/voxnote/actions/workflows/codeql.yml)
[![Pages](https://github.com/estcarisimo/voxnote/actions/workflows/pages.yml/badge.svg)](https://estcarisimo.github.io/voxnote/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0%20strict-3178c6.svg)](tsconfig.app.json)
[![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8.svg)](#-quick-start)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

### ▶️ Try it: **<https://estcarisimo.github.io/voxnote/>**

On an iPad, open the link in Safari, tap **Share**, then **Add to Home
Screen** to install it as an app. Install on a real iPad has not been verified
yet (see [Status](#-status-and-caveats)).

> **Status:** early (milestones M0–M1). The name is a working name pending
> availability and trademark checks. See [ROADMAP.md](ROADMAP.md).

## ✨ Features

- 📄 **Read any local PDF**: file picker or drag-and-drop, rendered by pdf.js
  with a selectable text layer
- ✍️ **Select with Pencil, touch or mouse**: pen drags build the text
  selection in the app (Apple Pencil on iPad does not select natively); a
  **Region** tool drags a box over figures, charts and equations
- 🖍️ **Four annotation kinds**: **Highlight** (no note required),
  **Comment** (typed), **Voice** (recorded with the microphone) and
  **Suggest** (edit the passage as it should read, Google Docs style, typed
  or dictated)
- 🗣️ **Opt-in transcription**: **Transcribe…** sends a recording to OpenAI
  with your own API key, only after a consent dialog that says exactly what
  is sent and to which host; the raw transcript is kept verbatim
- 🗂️ **Annotations sidebar**: group by kind, visibility or page; filter by
  kind, visibility, untranscribed voice notes or free text; edit bodies; mark
  each one **Private** or **For author**; tap to jump to the passage
- 📤 **Export, never upload**: **Export PDF** writes a copy with native PDF
  annotations (`/Highlight`, `/Square`, `/StrikeOut`, with comment text in
  the note); **Markdown** writes a page-by-page review report; **JSON** a
  machine-readable copy of the annotations (no audio)
- 💾 **Local-first**: PDFs, annotations and recordings stay in your browser
  (IndexedDB), keyed by the document's SHA-256, and come back when you reopen
  the same file
- 📲 **Installable PWA**: works offline once loaded; a new version waits
  until you tap **Reload**

### ⚠️ Status and caveats

Everything above works on `main` today, with these limits, all tracked in
[ROADMAP.md](ROADMAP.md):

- **No real transcription has been measured.** The OpenAI provider is
  verified against a mocked endpoint only; there are no accuracy or latency
  figures, and there will be none here without the dataset, parameters,
  provider version and date behind them.
- **Real-iPad confirmation is pending.** Pen-drag selection is verified
  headless with emulated pen events; installing the PWA and recording in
  Safari (its MP4 audio path and real permission prompt) are untested on an
  iPad. The offline shell is checked in desktop Chromium only.
- Exported PDFs are checked with poppler and qpdf; Preview, Acrobat, PDF
  Expert and Chrome are still to check.
- **Private** / **For author** is a label for your own triage: no export
  filters on it yet.

## 🚀 Quick Start

### In the browser

Open **<https://estcarisimo.github.io/voxnote/>**, then **Open a PDF** (or drop
a file on the page). Nothing is uploaded: the site is a static build
published from `main` by [`pages.yml`](.github/workflows/pages.yml).

### From source

Requires Node.js (CI uses Node 24) and npm.

```bash
git clone https://github.com/estcarisimo/voxnote.git
cd voxnote
npm ci
npm run dev
```

Then open the printed URL. To try it on an iPad on the same network, run
`npm run dev -- --host` and open the LAN address in Safari.

## 📖 Usage

The review flow is select, act, export:

1. **Open a PDF** with the file picker or by dropping it on the page.
2. **Select** a passage: drag with the Apple Pencil or the mouse, or use
   touch selection. For a figure with no text, switch to the **Region** tool
   and drag a box.
3. **Act** from the floating toolbar:
   - **Highlight** — marks the passage, no note needed.
   - **Comment** — type a note.
   - **Voice** — starts recording right away; **Stop**, replay or re-record,
     then **Save**. The audio stays on the device until you choose
     **Transcribe…**.
   - **Suggest** (text selections only) — edit the passage in place; saving
     needs an actual change.
4. **Review** in the **Annotations** panel: group, filter, edit bodies, set
   visibility, transcribe stored voice notes, delete, or tap an entry to
   scroll to its marks.
5. **Export** from the header:
   - **Export PDF** → a copy of the document with native annotations. The
     original file is never modified.
   - **Markdown** → `<name>.voxnote.md`, a page-by-page report with quotes,
     comments, suggestions (original and replacement) and voice notes with
     their raw transcripts, export time labeled UTC.
   - **JSON** → `<name>.voxnote.json`, the document name, SHA-256 id, page
     count and the annotations as stored, without audio.

## 🔐 Privacy and keys

- **Local-first by default.** PDFs, annotations and recordings are stored in
  your browser's IndexedDB on this origin. The site has no server, and
  documents never leave the browser.
- **Visit counting (decided, not yet live).** The live site will count
  visits with Google Analytics 4: page views on the landing view only, no
  custom events, never a file name, document id, annotation or transcript,
  and consent mode denied by default so no cookies are set. The measurement
  id is a build-time variable (`VITE_GA_MEASUREMENT_ID`) set only for the
  Pages build, so forks and local builds have no analytics. Until that
  change lands, the site has no analytics at all.
- **Keys are yours.** Provider API keys are entered in **Providers** and
  stored AES-GCM encrypted at rest, with a non-extractable key kept in
  IndexedDB. Any script running on this origin could still use them; they
  are never in this repository or on a server.
- **Consent before anything leaves.** Audio is sent only after the consent
  dialog, which states what is sent (the recording, optionally the quoted
  passage as a vocabulary hint, the language hint) and to which host, and
  only to the provider you picked. Nothing is uploaded until you tap
  **Send to OpenAI**.
- **Nothing is published automatically.** Exports are downloads you start.
- **The raw transcript is preserved.** It fills the comment only when nothing
  was typed, and stays visible read-only next to the editor.

Security problems go to the private channel in [SECURITY.md](SECURITY.md).

## 🔧 Configuration

All settings live in the **Providers** dialog, in your browser:

| Setting       | Values                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| Provider      | OpenAI (the only speech-to-text provider today; Deepgram is on the roadmap)                                 |
| Model         | `gpt-transcribe` (default), or the older `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `whisper-1`         |
| Language hint | An ISO 639-1 code such as `es` or `en`, or empty to let the model detect it                                 |
| API key       | Your own key, encrypted at rest in the browser and sent only in the request you confirm, straight to OpenAI |

Build-time: `npm run build` targets the GitHub Pages path `/voxnote/`, so
`npm run preview` serves the build at `http://localhost:4173/voxnote/`; the
dev server and the tests stay at the root path.

## 🏗️ Architecture

A static single-page app: Vite, React 19 and TypeScript (strict). pdf.js
(`pdfjs-dist`) renders pages and the text layer; pdf-lib writes the annotated
copy; `vite-plugin-pwa` (Workbox) precaches the app shell. Provider calls go
straight from the browser to the provider and are never cached.

```
src/
├── components/   # React UI: viewer, selection toolbar, composer, sidebar, dialogs
├── core/         # Pure, framework-free domain logic, fully unit-tested:
│                 #   annotation model, selection, store (IndexedDB), secrets,
│                 #   PDF / Markdown / JSON export, recording
├── hooks/        # React glue: annotations, providers, recorder, transcription
└── providers/    # Speech-to-text adapter interface and the OpenAI provider
public/           # PWA manifest and icons
```

Every provider implements the adapter in
[`src/providers/stt.ts`](src/providers/stt.ts), including the disclosure text
the consent dialog shows. The delivery-platform decision (web/PWA first,
native shell re-evaluated at the end of M1) is Decision 0 in
[ROADMAP.md](ROADMAP.md).

## 🧪 Development

```bash
npm test               # unit and component tests (Vitest + Testing Library)
npm run lint           # oxlint
npm run format         # Prettier (also formats Markdown); format:check in CI
npm run build          # typecheck + production build
```

Tests sit next to the code as `*.test.ts(x)`. CI runs lint, format,
typecheck-and-build, tests and `npm audit` on every push and pull request;
[CodeQL](.github/workflows/codeql.yml) scans the sources and workflows, and
[Security](.github/workflows/security.yml) re-runs `npm audit` weekly and
lints the workflows with zizmor. Actions are pinned by SHA.

Every change enters through a feature branch and a PR, reviewed by a
fresh-context, read-only reviewer following
[.github/REVIEW.md](.github/REVIEW.md) until `VERDICT: APPROVE` with CI green.
Coding agents follow [AGENTS.md](AGENTS.md). The session log lives on the
project's Notion page, linked from [ROADMAP.md](ROADMAP.md).

## 🗺️ Roadmap

[ROADMAP.md](ROADMAP.md) has the milestones: M0 foundations, M1 voice-first
review (validated on a real iPad), M2 handwriting, M3 review assistant, plus
the open decisions. [CHANGELOG.md](CHANGELOG.md) records what has landed.

## 🤝 Contributing

Contributions are welcome, especially real-device reports (iPad + Pencil),
speech-to-text evaluation samples and PRs against roadmap items.
[CONTRIBUTING.md](CONTRIBUTING.md) covers the branch-and-PR rule, the review
gate and the changelog. Please follow the
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security problems go to the private
channel in [SECURITY.md](SECURITY.md), not to the issue tracker.

1. Fork the repository
2. Create a feature branch (`git switch -c feat/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE)
file for details. To cite VoxNote, use [CITATION.cff](CITATION.cff) (GitHub
renders it under "Cite this repository").

## 🔗 Related Resources

- [VoxNote — AI-native PDF reviewing](https://app.notion.com/p/40837c171b0181c290bfc4baef7d8de8):
  the concept page and session log
- [pdf.js](https://mozilla.github.io/pdf.js/): PDF rendering and the text
  layer
- [pdf-lib](https://pdf-lib.js.org/): writing the annotated copy
- [ISO 32000-2 (PDF 2.0)](https://pdfa.org/resource/iso-32000-2/): the
  annotation types the export uses
- [OpenAI speech to text](https://platform.openai.com/docs/guides/speech-to-text):
  the transcription API behind the OpenAI provider
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): the changelog
  format

## 🙏 Acknowledgements

VoxNote stands on [pdf.js](https://github.com/mozilla/pdf.js) by Mozilla,
[pdf-lib](https://github.com/Hopding/pdf-lib) by Andrew Dillon,
[Vite](https://vite.dev/), [React](https://react.dev/),
[Workbox](https://developer.chrome.com/docs/workbox) and
[vite-plugin-pwa](https://vite-pwa-org.netlify.app/), and on
[Vitest](https://vitest.dev/), [oxlint](https://oxc.rs/) and
[Prettier](https://prettier.io/) for the tooling.

## 🎶 About the name

**Vox** is Latin for voice, the way most of a review gets into VoxNote.
**Vos** is the Rioplatense "you": the reviewer talking straight to the
author. **Vox Dei**, as in _vox populi, vox Dei_, is a wink at how a
reviewer's word lands on an author's desk. And a **Note** is what ends up in
the margin. The name is provisional until the clearance check in
[ROADMAP.md](ROADMAP.md) is done.
