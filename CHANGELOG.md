# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Transcribe on Stop, under a standing consent per document. The
  transcription dialog offers **Also do this automatically for this
  document** (off by default) with the sentence "From now on, each recording
  in this document is sent to <provider> at <host> as soon as you tap Stop."
  Once granted, Stop uploads at once through the same request path (one
  request at a time, Cancel aborts it, closing or switching the document
  settles it); the composer shows **Transcribing…** with **Cancel
  transcription**, and **Save** works before the transcript returns: the
  saved comment gets it on arrival, or the panel shows the error. The
  composer shows **Auto-transcribe: on**, and one tap turns it off; the
  Providers dialog turns it off everywhere. A provider, model or language
  change, or removing the key, revokes it. Stored in localStorage
  (`voxnote.stt.autoTranscribe`) with the provider, model, host, language
  hint, quote choice, the exact disclosure shown and a UTC grant time, never
  in an annotation. Another document starts without it.
- Design note for live transcription while recording
  (`docs/design/live-transcription.md`): provider streaming endpoints,
  capture, consent, fallback, raw-transcript rules and phasing. Not
  implemented.

- Landing view redesigned so a first visit explains the app: the app icon,
  the tagline, one sentence on what VoxNote does, the **Open a PDF** button
  with the drop hint, a three-item row (Highlight, Comment by voice, Suggest
  a replacement), a plain-words privacy line, an install hint hidden when
  the app already runs standalone, and a footer linking the repository and the MIT
  license. The file picker and drag-and-drop are
  unchanged.
- Visit counting with Google Analytics 4, decided 2026-10-29 with strict
  limits: the measurement id comes from the build-time variable
  `VITE_GA_MEASUREMENT_ID` (on GitHub Pages, a repository variable of the
  same name); unset means no script is loaded and no request leaves the
  browser. When set, gtag.js loads from the landing view only, sends a
  single `page_view`, no custom events, never a file name, document id,
  annotation or transcript; consent defaults deny analytics and ad storage
  and every ad signal, so no cookies are set. The landing privacy line says so.
- Project scaffold: Vite, React 19, TypeScript strict, oxlint, Prettier,
  Vitest.
- Open a local PDF (file picker or drag-and-drop) and render all pages with
  pdf.js, including the selectable text layer.
- Repository hygiene per the Open source manifesto: `AGENTS.md`, `CLAUDE.md`,
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CITATION.cff`,
  `.github/REVIEW.md`, `ROADMAP.md`.
- CI (lint, format, typecheck and build, test, audit) with SHA-pinned
  actions, Dependabot, CODEOWNERS, issue forms and a PR template.
- Annotation data model (schema version 1): text anchors with quote, PDF-space
  rectangles and text offsets; region anchors; kind, visibility and UTC
  timestamps. Validated at every edge.
- Highlights: select text with pointer, touch or pen and tap **Highlight** in
  the floating toolbar; or switch to the **Region** tool and drag over a
  figure, chart or equation.
- Local-first persistence in IndexedDB keyed by the document's SHA-256;
  reopening the same PDF restores its highlights.
- App-driven pen text selection: a pen drag over the text layer builds the
  selection itself and cancels the pen's touch pan, for Apple Pencil on
  iPad, where native selection did not respond to a Pencil drag. Verified
  headless with emulated pen events; real-iPad confirmation pending. Touch
  and mouse keep native selection.
- **Highlights** panel listing annotations with jump-to-page and delete.
- **Export PDF**: writes a copy with native `/Highlight` and `/Square`
  annotations (pdf-lib); the original file is never modified.
- Comments: the selection toolbar now offers **Highlight**, **Comment** and
  **Voice** for text selections and regions. A typed comment needs no
  provider. A voice comment records with the microphone (record, stop,
  replay, re-record); the audio stays on this device in IndexedDB and can be
  replayed from the panel. Comment bodies are editable in the panel.
- Speech-to-text adapter interface (`src/providers/stt.ts`) with the
  disclosure hook every provider must implement.
- OpenAI transcription provider (`gpt-transcribe` by default; the older
  `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` and `whisper-1` selectable).
  **Providers** dialog to store your own API key, pick the model and set an
  optional language hint. The key is AES-GCM encrypted at rest with a
  non-extractable key kept in IndexedDB on this origin; it is sent only in
  the request you confirm, straight to the provider. VoxNote has no server.
- **Transcribe…** on a fresh recording or on a stored voice note opens a
  consent dialog that states exactly what is sent (the recording, optionally
  the quoted passage as a vocabulary hint, the language hint) and to which
  host. Nothing is uploaded until **Send** is tapped. The raw transcript is
  stored verbatim; it fills the comment body only when nothing was typed and
  stays visible read-only next to the editor.
- Exported comments carry their text in `/Contents`, so PDF viewers show them
  as notes. Audio is not embedded in the export.
- Suggestions: **Suggest** in the selection toolbar (text selections only)
  opens the selected text for editing in place, Google Docs style, typed or
  dictated; saving needs an actual change. The panel shows the original
  struck through and the replacement inserted, editable. Exported as native
  `/StrikeOut` annotations over the original with "Replace with: …" in the
  note. The PDF itself is never changed.
- Export group in the header: **Export PDF**, **Markdown** and **JSON**. The
  Markdown report (`<name>.voxnote.md`) lists annotations page by page, top
  to bottom, with the quoted passage or region, comment bodies, suggestions as
  original and replacement, and voice notes with duration and the raw
  transcript marked as raw; the export time is labeled UTC. The JSON export
  (`<name>.voxnote.json`) holds the document name, SHA-256 id and page count
  and the annotations exactly as stored, without audio. Both are generated in
  the browser and only downloaded; nothing is uploaded.
- Installable PWA: web app manifest, VoxNote icons (SVG plus PNG, maskable
  and Apple touch) and an offline app shell precached by a service worker
  (`vite-plugin-pwa`); a new version waits behind a dismissible "Update
  available — Reload" bar. Not yet tried on an iPad.
- Review sidebar: the **Annotations** panel groups annotations by kind,
  visibility or page (reading order within each group), filters them by kind,
  visibility, untranscribed voice notes and free text across quotes, notes
  and raw transcripts, and shows how many of the total are shown. Each
  annotation can be marked **Private** or **For author**; this is stored
  metadata for now, the exports do not filter on it yet. Tapping an
  annotation scrolls to its marks when its page has rendered, else to the
  page.
- Optional LLM clean-up of a dictated note, a separate opt-in action:
  **Clean up…** appears next to a raw transcript in the composer and in the
  **Annotations** panel. It sends the raw transcript (never the edited body),
  optionally the quoted passage as a spelling hint, and the language hint to
  the chosen text provider, after a consent dialog that names the host and the
  model and shows the exact prompt (`CLEAN_UP_INSTRUCTIONS`, version 1, in
  `src/providers/llm.ts`). Nothing is sent until **Send**; **Cancel** aborts
  the request. A review step shows the raw transcript and the proposal side by
  side; only **Accept** changes the note, **Discard** changes nothing. An
  empty, unchanged, or wildly longer or shorter answer is rejected with an
  error instead of being proposed (`CLEAN_UP_LENGTH_LIMITS`: within 20
  characters, or 50–150% of the raw length). The raw transcript is never
  modified.
- Text-model providers behind one `TextModelProvider` interface: OpenAI
  (Responses API; `gpt-6.1-terra` default, `gpt-6-luna`, `gpt-6.1-sol`,
  `gpt-6-astra`), Anthropic (Messages API; `claude-opus-5-5` default,
  `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`) and xAI
  (Responses API; `grok-4.7` default, `grok-4.6`,
  `grok-4.20-0309-non-reasoning`). Model ids as listed in each vendor's
  documentation on 2026-10-29. Verified against mocked endpoints only: no
  real provider call has been made.
- **Providers** lists speech-to-text and clean-up separately, each with its
  own provider and model; keys are kept one per provider (OpenAI's key serves
  both), each encrypted at rest as before.
- A cleaned-up body is marked as such: in the panel ("Cleaned up with
  provider/model", "then edited" once changed by hand), in the Markdown
  export's label, and in the PDF note, which then also carries the raw
  transcript labeled as raw.
- GitHub Pages deployment: `.github/workflows/pages.yml` builds on every push
  to `main` (or on demand) and publishes the static build to
  <https://estcarisimo.github.io/voxnote/>; production builds and
  `npm run preview` use the `/voxnote/` base path.
- README rewritten to the maintainer's standard (badges, features with
  caveats, usage, privacy, configuration, architecture, about the name);
  CodeQL code scanning and a Security workflow (weekly `npm audit`, zizmor on
  the workflows); workflow checkouts no longer persist credentials.

### Changed

- The **Highlights** panel is now **Annotations** and lists comments with
  their quote, body and voice badge.
- IndexedDB schema version 2 adds an `audio` object store; version 1
  databases upgrade in place.
- Annotation schema version 2 adds the optional `cleanUp` record
  (`provider`, `model`, `createdAt` in UTC, `promptVersion`, `editedAfter`)
  on comments and suggestions. Version 1 records are read as version 2
  without changes to their content and rewritten on the next save.
- The session log moved from `docs/SESSION_LOG.md` to the project's Notion
  page; the repository only links to it.

### Fixed

- Stray selection box at the top-left corner of a page while selecting text.
