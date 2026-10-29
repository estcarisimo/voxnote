# Session log

Newest entry first. Every session closes with: what was done, what was
verified, what is pending, branch/commit/PR, next concrete action.

## 2026-10-29 — GitHub repository, CI, ruleset

**Done.** Created the public repository `estcarisimo/voxnote` and pushed
`main`. On branch `ci/initial-workflows` (PR #1): CI workflow (lint, format,
typecheck-build, test, audit; `permissions: contents: read`; actions pinned
to commit SHAs), Dependabot (grouped minor/patch, `increase-if-necessary`),
`CODEOWNERS`, issue forms, PR template, changelog entry. Ticked the M0 items
in `ROADMAP.md`.

**Verified (2026-10-29, UTC).**

- Private vulnerability reporting: enabled via
  `gh api -X PUT repos/estcarisimo/voxnote/private-vulnerability-reporting`;
  `gh api repos/estcarisimo/voxnote/private-vulnerability-reporting` returned
  `enabled: true` at 01:52Z.
- Ruleset `protect-main` (id 26090586) active at 01:53Z, created with
  `gh api -X POST repos/estcarisimo/voxnote/rulesets`: PR required, five
  required status checks with branch up to date, review-thread resolution
  required, no force-push, no deletion, bypass limited to Repository admin.
  `delete_branch_on_merge` on via `gh repo edit`.
- CI on PR #1: all five checks green on the first run.
- Review gate: round 1 by a fresh read-only Sonnet subagent, `VERDICT:
APPROVE`, posted as a PR comment. Round 2 run on the final commit after
  adding this log entry and the roadmap ticks (result recorded below).

**Pending.** GitHub Pages deployment of the static build; name clearance;
license confirmation (MIT assumed); real-iPad check of the viewer.

**Branch / commit / PR.** `ci/initial-workflows`, PR #1.

**Next concrete action.** Merge PR #1, then start M1.1 (annotation data model
and highlights) on a feature branch.

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
