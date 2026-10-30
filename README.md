# 🎙️ VoxNote

> **Your voice, in the margins.**

An open-source, AI-native PDF reviewer for iPad and the browser. Select a
passage with the Apple Pencil, a finger or the mouse, then highlight it,
comment on it, record a voice note or suggest a rewording — the PDF itself is
never edited. Annotations live beside the document in your browser and are
exported into a copy (annotated PDF, Markdown report or JSON). There is no
backend: VoxNote is a static web app, local-first by default, and audio or
transcript text leaves the device only when you confirm a transcription or a
polish with your own provider key.

[![CI](https://github.com/estcarisimo/voxnote/actions/workflows/ci.yml/badge.svg)](https://github.com/estcarisimo/voxnote/actions/workflows/ci.yml)
[![Security](https://github.com/estcarisimo/voxnote/actions/workflows/security.yml/badge.svg)](https://github.com/estcarisimo/voxnote/actions/workflows/security.yml)
[![CodeQL](https://github.com/estcarisimo/voxnote/actions/workflows/codeql.yml/badge.svg)](https://github.com/estcarisimo/voxnote/actions/workflows/codeql.yml)
[![Pages](https://github.com/estcarisimo/voxnote/actions/workflows/pages.yml/badge.svg)](https://estcarisimo.github.io/voxnote/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0%20strict-3178c6.svg)](tsconfig.app.json)
[![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8.svg)](#-quick-start)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

### ▶️ Try it: **<https://estcarisimo.github.io/voxnote/>**

Documentation for language models:
[`llms.txt`](https://estcarisimo.github.io/voxnote/llms.txt) (an index of
what to read) and
[`llms-full.txt`](https://estcarisimo.github.io/voxnote/llms-full.txt) (the
project in one file). See [Discoverability](#-discoverability).

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
- 🗣️ **Opt-in transcription**: **Transcribe…** sends a recording to OpenAI,
  Deepgram or Groq (hosted Whisper) with your own API key, only after a consent dialog that says exactly what
  is sent and to which host; the raw transcript is kept verbatim
- 🧹 **Opt-in polish**: **Polish…** asks a text model (OpenAI, Anthropic
  Claude or xAI Grok, each with your own key) to fix punctuation, casing,
  fillers and technical terms in a raw transcript; the consent dialog names
  the host and model and shows the exact prompt, the raw text and the
  proposal sit side by side, and only **Accept** changes the note. The raw
  transcript is never touched, and a polished body is labeled as such in the
  sidebar and the exports
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

### 🚧 Status and caveats

Everything above works on `main` today, with these limits, all tracked in
[ROADMAP.md](ROADMAP.md):

- **No real transcription has been measured.** The OpenAI, Deepgram and
  Groq providers are verified against mocked endpoints only (whether
  Deepgram and Groq accept calls straight from a browser is unknown until a
  real call); there are no accuracy or latency
  figures, and there will be none here without the dataset, parameters,
  provider version and date behind them.
- **No real polish call has been made.** The OpenAI, Anthropic and xAI
  text adapters are verified against mocked endpoints only; whether each
  vendor accepts calls straight from a browser, and the quality, latency and
  cost of the polished text, are unmeasured.
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
   touch selection (on an iPad, a finger needs a long press). For a figure with no text, switch to the **Region** tool
   and drag a box.
3. **Act** from the floating toolbar:
   - **Highlight** — marks the passage, no note needed.
   - **Comment** — type a note.
   - **Voice** — starts recording right away; **Stop**, replay or re-record,
     then **Save**. The audio stays on the device until you choose
     **Transcribe…** and confirm. Ticking **Also do this automatically for
     this document** in that dialog makes **Stop** send each later
     recording of this document straight away (the composer shows
     **Auto-transcribe: on**; tap it to turn it off), and you can **Save**
     before the transcript comes back. Once there is a raw transcript, **Polish…** offers
     an optional polished version: review it next to the raw text, then
     **Accept** or **Discard**.
   - **Suggest** (text selections only) — edit the passage in place; saving
     needs an actual change.
4. **Review** in the **Annotations** panel: group, filter, edit bodies, set
   visibility, transcribe or polish stored voice notes, delete, or tap an
   entry to scroll to its marks.
5. **Keys** for transcription and polish go under **AI keys** (the key
   icon in the header): tap **Add key**, pick the provider, paste the key,
   **Save**. The row then shows what the key is used for; the trash button
   removes it after a confirmation.
6. **Export** from the header:
   - **Export PDF** → a copy of the document with native annotations. The
     original file is never modified.
   - **Markdown** → `<name>.voxnote.md`, a page-by-page report with quotes,
     comments, suggestions (original and replacement) and voice notes with
     their raw transcripts; a polished body is labeled with its provider and
     model, export time labeled UTC.
   - **JSON** → `<name>.voxnote.json`, the document name, SHA-256 id, page
     count and the annotations as stored, without audio.

## 🔐 Privacy and keys

- **Local-first by default.** PDFs, annotations and recordings are stored in
  your browser's IndexedDB on this origin. The site has no server, and
  documents never leave the browser.
- **Visit counting.** The live site counts visits with Google Analytics 4,
  without cookies: the build reads the measurement id from the repository
  variable `VITE_GA_MEASUREMENT_ID`, loads gtag.js from the landing view only,
  denies analytics and ad storage and every ad signal by default, and sends a
  page view. The app defines no custom events; GA4's default "enhanced
  measurement" also reports scroll depth and engagement time on the landing
  (seen in the network log on 2026-10-30). Never a file name, document id,
  annotation or transcript. A build without the variable (your own checkout,
  a fork) ships no analytics at all. Counting on the live site started on
  2026-10-30, when the variable was set and `main` was deployed again.
- **Keys are yours.** API keys are added under **AI keys** (the key icon in
  the header) and stored AES-GCM encrypted at rest, with a non-extractable
  key kept in IndexedDB. A saved key is never shown again, not even
  partially. Any script running on this origin could still use them; they
  are never in this repository or on a server.
- **Consent before anything leaves.** Audio is sent only after the consent
  dialog, which states what is sent (the recording, optionally the quoted
  passage as a vocabulary hint, the language hint) and to which host, and
  only to the provider you picked. Nothing is uploaded until you tap
  **Send to …** (OpenAI, Deepgram or Groq). A polish sends the raw transcript text (optionally
  the quoted passage, to spell terms) to the text provider you picked, with
  `store: false` on OpenAI and xAI, only after you tap **Send to …**.
- **Nothing is published automatically.** Exports are downloads you start.
- **The raw transcript is preserved.** It fills the comment only when nothing
  was typed, and stays visible read-only next to the editor. A polish never
  replaces it; an accepted one changes only the note body.

Security problems go to the private channel in [SECURITY.md](SECURITY.md).

## 🔧 Configuration

All settings live in the **AI keys** dialog (the key icon in the header), in
your browser. It lists the keys stored in this browser, one row per provider,
with what each is used for (speech-to-text, polish or both), the model to
use, and a trash button that asks for confirmation before deleting the key.
**Add key** opens an inline row with a provider select, limited to providers
without a key and labeled by what they do, and a key field. When more than
one stored key can serve a role, a **Use for polish** (or **Use for
speech-to-text**) select picks which; with a single candidate it is implicit.
Speech to text:

| Setting       | Values                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider      | OpenAI (default), Deepgram or Groq (hosted Whisper)                                                                                                                                                                     |
| Model         | OpenAI `gpt-transcribe` (default), or the deprecated `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `whisper-1`; Deepgram `nova-3` (default) or `nova-2`; Groq `whisper-large-v3-turbo` (default) or `whisper-large-v3` |
| Language hint | An ISO 639-1 code such as `es` or `en`, or empty to let the model detect it (Deepgram: `detect_language`)                                                                                                               |

The quoted passage can be sent as a vocabulary hint to OpenAI and Groq;
Deepgram has no prompt parameter, so the option is not offered for it.

Polish (optional):

| Setting  | Values                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| Provider | OpenAI (default), Anthropic (Claude) or xAI (Grok)                                                               |
| Model    | OpenAI `gpt-6.1-terra` (default); Anthropic `claude-opus-5-5` (default); xAI `grok-4.7` (default); others listed |

API keys: one per provider (OpenAI, Anthropic, xAI, Deepgram, Groq), your own, encrypted at
rest in the browser and sent only in the request you confirm, straight to
that provider. Adding a key for a provider that can serve a role nobody else
covers (the first Anthropic key, say, for polish) picks it for that role;
removing the key in use moves the role to the next stored key, if any.

Where to get a key, what each provider does in VoxNote, and what the
vendors' pricing pages said when read. VoxNote is not affiliated with any of
these companies. You pay them directly under your own account, and audio
goes from your device to the provider you chose. Prices change: each row
carries the date and the page its figures were read from, and the vendor's
page wins over this table.

| Provider  | Role in VoxNote | Default model            | Pay-as-you-go price for audio, as stated by the vendor                                                                                                                 | Free credit, as stated by the vendor                                                                                                  | Key page                                     | Source, read 2026-10-30 (UTC)                                                                                                                                                                  |
| --------- | --------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deepgram  | Speech-to-text  | `nova-3`                 | Pre-recorded Nova-3 (what VoxNote sends): "$0.0043 / min" monolingual, "$0.0052 / min" multilingual                                                                    | "Free $200 credit"; the FAQ says "No credit card is required to start."                                                               | <https://console.deepgram.com/>              | <https://deepgram.com/pricing>                                                                                                                                                                 |
| Groq      | Speech-to-text  | `whisper-large-v3-turbo` | "$0.04" per hour for `whisper-large-v3-turbo`, "$0.111" per hour for `whisper-large-v3`; the docs quote hours, not minutes                                             | A free tier exists (the docs name it only in the "25 MB (free tier)" file limit); its audio allowance is not stated on the pages read | <https://console.groq.com/keys>              | <https://console.groq.com/docs/speech-to-text> and <https://console.groq.com/docs/models>; <https://groq.com/pricing> redirected to the home page and stated no speech-to-text figure that day |
| OpenAI    | Speech-to-text  | `gpt-transcribe`         | "$0.0045 / minute" (estimated cost) for `gpt-transcribe`; `gpt-4o-transcribe` "$0.006 / minute", `gpt-4o-mini-transcribe` "$0.003 / minute", Whisper "$0.006 / minute" | Not stated on the pricing page                                                                                                        | <https://platform.openai.com/api-keys>       | <https://developers.openai.com/api/docs/pricing>                                                                                                                                               |
| OpenAI    | Polish          | `gpt-6.1-terra`          | Billed per token, not per minute                                                                                                                                       | Not stated on the pricing page                                                                                                        | <https://platform.openai.com/api-keys>       | <https://developers.openai.com/api/docs/pricing>                                                                                                                                               |
| Anthropic | Polish          | `claude-opus-5-5`        | Billed per token, not per minute                                                                                                                                       | "New users receive a small amount of free credits to test the API."                                                                   | <https://platform.claude.com/settings/keys>  | <https://platform.claude.com/docs/en/about-claude/pricing>                                                                                                                                     |
| xAI       | Polish          | `grok-4.7`               | Billed per token, not per minute                                                                                                                                       | Not stated on the models and pricing page                                                                                             | <https://console.x.ai/team/default/api-keys> | <https://docs.x.ai/docs/models>                                                                                                                                                                |

Whether Deepgram and Groq accept calls straight from a browser (CORS) is
still unverified: no real call has been made to either.

Build-time: `npm run build` targets the GitHub Pages path `/voxnote/`, so
`npm run preview` serves the build at `http://localhost:4173/voxnote/`; the
dev server and the tests stay at the root path.

`VITE_GA_MEASUREMENT_ID` (build-time, optional): a Google Analytics 4
measurement id. The Pages workflow passes the GitHub Actions repository
variable of the same name into the build; leave it unset for a build with
no analytics. The id is never committed.

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
├── hooks/        # React glue: annotations, providers, recorder, transcription,
│                 #   polish
└── providers/    # Speech-to-text and text-model adapters: OpenAI,
                  #   Deepgram and Groq transcription; OpenAI, Anthropic
                  #   and xAI polish
public/           # PWA manifest and icons, llms.txt, robots.txt, sitemap.xml
```

Every speech-to-text provider implements the adapter in
[`src/providers/stt.ts`](src/providers/stt.ts) and every text model the one
in [`src/providers/llm.ts`](src/providers/llm.ts), which also holds the
polish prompt; each includes the disclosure text the consent dialog shows.
The delivery-platform decision (web/PWA first, native shell re-evaluated at
the end of M1) is Decision 0 in [ROADMAP.md](ROADMAP.md).

## 🔎 Discoverability

What search engines and AI agents find, how it is served, and what is left
for a human to do. Nothing here submits VoxNote anywhere: registering with
an index is a manual step, listed last.

- **`llms.txt` and `llms-full.txt`** ([llmstxt.org](https://llmstxt.org/)):
  hand-written in [`public/`](public/), copied as-is by Vite into the Pages
  build, and served at
  <https://estcarisimo.github.io/voxnote/llms.txt> and
  <https://estcarisimo.github.io/voxnote/llms-full.txt> once `main` is
  deployed. The index links the README, roadmap, changelog and design notes
  as raw Markdown; the full text describes the app, the privacy rules and
  the non-affiliation with providers, and carries the date it was written.
  The README wins where they disagree, so a PR that changes what the app
  does should update both.
- **`robots.txt`** allows every crawler everywhere (the app has no server
  and no per-user pages) and names the sitemap. **`sitemap.xml`** lists the
  landing, the site's only page; it has no `lastmod`, because the file is
  not regenerated on deploy and a stale date would be a false claim.
- **`index.html`** carries a `<meta name="description">` for search result
  snippets.
- **`context7.json`** at the repository root tells
  [Context7](https://context7.com/), the documentation index that coding
  agents query, to index `docs/` and the root Markdown, to skip the source,
  tests, build output and maintainer files (`AGENTS.md`, `CLAUDE.md`,
  `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`), and gives it the
  product rules as usage notes. The file follows
  `https://context7.com/schema/context7.json` (fetched 2026-10-30 (UTC) with
  `curl`; every rule is under the schema's 255-character limit).
- A unit test, [`src/discoverability.test.ts`](src/discoverability.test.ts),
  checks that these files exist, that every absolute URL in them points at
  the live site or the repository, that `robots.txt` names the sitemap and
  that `context7.json` fits the schema's limits.

**Submitting to Context7 (manual, not done by any workflow).** Open
<https://context7.com/add-library>, which on 2026-10-30 (UTC) accepted
"GitHub repositories, websites, OpenAPI specifications, or llms.txt"
(`curl -sSL https://context7.com/add-library`), and paste
`https://github.com/estcarisimo/voxnote`. Context7 reads `context7.json`
from the default branch. Record the submission date and the resulting
library page in the session log.

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
- [Deepgram pre-recorded audio](https://developers.deepgram.com/docs/pre-recorded-audio)
  and [Groq speech to text](https://console.groq.com/docs/speech-to-text):
  the transcription APIs behind the Deepgram and Groq providers
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create),
  [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages.md)
  and
  [xAI Responses API](https://docs.x.ai/developers/rest-api-reference/inference/responses):
  the text models behind the optional polish
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
