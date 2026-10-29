# VoxNote roadmap

> **Your voice, in the margins.** An open-source, AI-native document reviewer
> for reading, highlighting, commenting and suggesting on PDFs — never editing
> them.

Source of truth for the concept: the Notion page
[VoxNote — AI-native PDF reviewing](https://app.notion.com/p/40837c171b0181c290bfc4baef7d8de8).
This file turns that concept into shippable slices. Each slice ends in
something a reviewer can use on an iPad, so the thesis ("faster and less
frustrating than the current iPad workflow") gets tested early.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done.

---

## Decision 0 — delivery platform (2026-10-28)

The Notion concept hypothesises native SwiftUI + PDFKit + PencilKit and says
to _validate first_. The development machine is Linux (no Swift, no Xcode), so a
native iPad app cannot be built or tested here today.

**Decision:** build M0–M1 as a **web app / PWA** that runs in Safari on iPad.

| Need (from concept)         | Web answer                                       |
| --------------------------- | ------------------------------------------------ |
| PDF rendering + text layer  | pdf.js (`pdfjs-dist`)                            |
| Pencil / touch / pointer    | Pointer Events (`pointerType: pen`, pressure)    |
| Voice capture + playback    | `MediaRecorder` + `<audio>`                      |
| Pluggable STT / LLM         | Provider adapters over HTTP, BYO API key         |
| Local-first storage         | IndexedDB (Origin Private File System for blobs) |
| Export                      | annotated PDF via `pdf-lib`, Markdown, JSON      |
| Install on iPad home screen | PWA manifest + service worker                    |

What this buys: one codebase, developable from Linux, testable in any browser,
deployable as a static site. What it costs: no PencilKit handwriting
recognition (relevant to M2, not M1), and `MediaRecorder` on iOS Safari
produces `audio/mp4`, which every STT adapter must accept.

**Re-evaluate** at the end of M1. If the web stack blocks the success criterion
(taps/interruptions between select → speak → confirm → resume), the annotation
model and provider adapters are platform-agnostic and port to a native shell.

---

## M0 — Foundations

Goal: a repository that follows the Open source manifesto and shows a PDF.

- [x] Vite + React + TypeScript scaffold, strict TS, oxlint, Prettier, Vitest.
- [x] Manifesto hygiene: `AGENTS.md` (+ `CLAUDE.md`), `CONTRIBUTING.md`,
      `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CITATION.cff`, `CHANGELOG.md`,
      `.github/REVIEW.md`, LICENSE. The session log lives on the Notion page.
- [x] Open a local PDF (file picker / drag-drop) and render pages with pdf.js,
      including the selectable text layer.
- [x] GitHub repository, `protect-main` ruleset, CI (lint, format, typecheck
      and build, test, audit), Dependabot, private vulnerability reporting
      verified (2026-10-29, evidence in the session log on the Notion page).
- [ ] Deploy the static build (GitHub Pages) so it can be opened on a real iPad.
- [ ] Name clearance check: GitHub, npm, domains, App Store, trademarks. Record
      the evidence; the name stays provisional until then.

## M1 — Voice-first PDF review

Goal: one paper, three annotation types, voice in, portable export. Validate
the success criterion on real iPad hardware.

### M1.1 Anchors and highlights

- [x] Annotation data model: document id (content hash), page, selected quote,
      text offsets and bounding rects, kind, visibility (private /
      author-facing), timestamps. Versioned JSON schema.
- [x] Text selection with Pencil, touch and pointer → **Highlight** with no
      obligatory note. (Pointer verified headless; Pencil and touch pending a
      real iPad.)
- [x] Region (rectangle) selection for figures, charts and equations where
      there is no text.
- [x] Persist locally in IndexedDB; reload restores annotations onto the PDF.
- [~] Interoperability test: export highlights as native PDF annotations with
  `pdf-lib` and open the result in Preview, Acrobat, PDF Expert, Chrome.
  Export done; verified with poppler (pdftoppm) and qpdf. Preview,
  Acrobat, PDF Expert and Chrome still to check.

### M1.2 Comments by voice

- [x] **Comment** attached to an anchor; typed path first, so the flow works
      without any provider.
- [~] Microphone button in the selection toolbar; record, stop, replay,
  re-record. Verified in headless Chromium with a fake microphone only;
  Safari's MP4 path and the real permission prompt are untested. Taps from selection to saved comment, counted in the headless
  run on 2026-10-29: typed = Comment, type, Save (2 taps + typing); voice =
  Voice (starts recording), Stop, Save (3 taps). Not yet counted on iPad.
- [~] STT adapter interface (`src/providers/stt.ts`) and the OpenAI provider
  (`gpt-transcribe`, plus the deprecated `gpt-4o-transcribe`,
  `gpt-4o-mini-transcribe`, `whisper-1`) done, verified against a mocked
  endpoint only on 2026-10-29: no real transcription has been run yet. Keys
  are encrypted at rest in the browser (AES-GCM, non-extractable key in
  IndexedDB; any script on this origin can still use them). Deepgram pending.
  Keys never in the repo or in a server.
- [x] Editable comment body; the raw transcript is kept verbatim and shown
      read-only next to the editor once a provider fills it.
- [x] Explicit disclosure before anything leaves the device: the consent
      dialog states what is sent (recording, optional quote hint, language
      hint) and to which host; nothing is uploaded until Send is tapped.
- [ ] Evaluation set: Argentine Spanish, accented English, code-switching,
      technical vocabulary. Record WER per provider with the audio, the
      parameters and the date. No unmeasured claims.

### M1.3 Suggestions

- [x] **Suggestion** = original text + proposed text, Google Docs style, PDF
      untouched. Voice or typed. Exported as `/StrikeOut` with the
      replacement in `/Contents`; verified with poppler on 2026-10-29, not
      yet in Preview/Acrobat/PDF Expert/Chrome.
- [ ] Optional LLM clean-up (punctuation, technical terms) as a separate
      opt-in action. Never silently reinterpret a critique.

### M1.4 Review sidebar and export

- [ ] Sidebar listing annotations grouped by kind and visibility; filter;
      tap → jump to the source passage.
- [ ] Export: annotated PDF, Markdown report with page and quote references,
      machine-readable JSON. Nothing is ever sent or published automatically.
- [ ] PWA manifest + offline shell so it installs on the iPad home screen.

### M1 exit criterion

A real review of one paper done end-to-end on iPad, with the count of taps and
interruptions compared against the current workflow, written in the session log on the Notion page.

## M2 — Handwriting

- [ ] Full-size writing area opened from the selection toolbar.
- [ ] Handwriting → text. Compare: on-device (Scribble in iOS text fields),
      cloud (Google Cloud Vision / Azure Ink), and a native shell with PencilKit.
      This milestone is where the native-vs-web decision gets revisited.
- [ ] Non-destructive conversion: the ink stays, the text becomes a comment.

## M3 — Review assistant

- [ ] Context-aware vocabulary: feed the paper's terms to STT/LLM prompts.
- [ ] Organise and cluster comments; suggest wording; draft a reviewer report
      from the annotations. The reviewer keeps final judgement on every line.
- [ ] Agent-friendly structured export (the JSON schema from M1.1, documented).

## Non-goals

Not a PDF editor. Not a general PDF chatbot. The app never changes the
underlying document and never invents reviewer claims.

## Open decisions

- License (MIT assumed for the scaffold; confirm).
- Native shell timing (see Decision 0).
- Whether on-device STT (whisper.cpp via WebAssembly) is viable on iPad for
  fully offline review of confidential manuscripts.
