# Session log

Newest entry first. Every session closes with: what was done, what was
verified, what is pending, branch/commit/PR, next concrete action.

## 2026-10-28 — project start

**Done.** Read the VoxNote concept page and the Open source manifesto in
Notion. Decided to build M0–M1 as a web app / PWA (pdf.js, Pointer Events,
MediaRecorder) because the development machine is Linux without Swift or
Xcode; recorded as Decision 0 in `ROADMAP.md`. Scaffolded Vite + React 19 +
TypeScript, added Vitest, Prettier, pdf.js. Wrote `ROADMAP.md`, `AGENTS.md`,
`CLAUDE.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
`CITATION.cff`, `CHANGELOG.md`, `LICENSE` (MIT, to confirm),
`.github/REVIEW.md`. Implemented M0 slice: open a local PDF and render all
pages with the selectable text layer.

**Verified (2026-10-28).** `npm run lint`, `npm run build`, `npm test`
(5 tests, 2 files) and `npm run format:check` all pass. Headless Chromium
(`/usr/bin/chromium` via playwright-core, script kept out of the repo) opened
`Agraph.pdf` from `/usr/share/doc/graphviz`: 31 pages rendered, 7 text spans
on page 1, a mouse drag selected `Emden R. Gansner / erg@graphviz.com /
February 7, 2014`, zero console errors. Known cosmetic issue: a small stray
selection box at the top-left of a page from the pdf.js `endOfContent` span;
fix when the selection toolbar lands in M1.1. The Claude in Chrome extension
could not reach this host's localhost, so the real-iPad check is still
pending.

**Pending.** GitHub repository and `protect-main` ruleset (not created: needs
the owner's go-ahead). CI, Pages deployment, Dependabot, PVR verification.
Name clearance. License confirmation.

**Branch / commit.** `main`, initial commit (first commit of an empty repo;
from here on every change goes through a feature branch and PR).

**Next concrete action.** Create the GitHub repository, push, add CI and the
`protect-main` ruleset; then start M1.1 (annotation model + highlights) on a
feature branch.
