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

### Fixed

- Stray selection box at the top-left corner of a page while selecting text.

### Changed

- The session log moved from `docs/SESSION_LOG.md` to the project's Notion
  page; the repository only links to it.
