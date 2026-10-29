# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
- **Highlights** panel listing annotations with jump-to-page and delete.
- **Export PDF**: writes a copy with native `/Highlight` and `/Square`
  annotations (pdf-lib); the original file is never modified.
- Comments: the selection toolbar now offers **Highlight**, **Comment** and
  **Voice** for text selections and regions. A typed comment needs no
  provider. A voice comment records with the microphone (record, stop,
  replay, re-record); the audio stays on this device in IndexedDB and can be
  replayed from the panel. Comment bodies are editable in the panel.
- Speech-to-text adapter interface (`src/providers/stt.ts`) with the
  disclosure hook every provider must implement; no provider ships yet, so
  nothing leaves the device.
- Exported comments carry their text in `/Contents`, so PDF viewers show them
  as notes. Audio is not embedded in the export.

### Changed

- The **Highlights** panel is now **Annotations** and lists comments with
  their quote, body and voice badge.
- IndexedDB schema version 2 adds an `audio` object store; version 1
  databases upgrade in place.
- The session log moved from `docs/SESSION_LOG.md` to the project's Notion
  page; the repository only links to it.

### Fixed

- Stray selection box at the top-left corner of a page while selecting text.
