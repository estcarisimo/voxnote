# AGENTS.md — instructions for coding agents

VoxNote is an open-source, AI-native PDF reviewer: highlight, comment and
suggest on a PDF without ever editing it. Read `ROADMAP.md` for scope and
`docs/SESSION_LOG.md` (last entry) before touching code.

## Language policy (mandatory)

All agent instructions, identifiers, function and method names are written in
**American English** (`initialize`, `analyze`, `color`). Commit messages, PR
text and docs follow the same rule.

## Stack

- Vite + React 19 + TypeScript (strict). `npm run dev`, `npm run build`.
- pdf.js (`pdfjs-dist`) for rendering and the text layer.
- Vitest + Testing Library for tests: `npm test`.
- oxlint and Prettier: `npm run lint`, `npm run format:check`.
- No backend. API keys for speech or LLM providers are the user's own and live
  only in the browser. Nothing in this repo may embed or log a secret.

## Process

- **Never push to `main`.** Every change enters through a feature branch and a
  PR, even one line. Undo with a revert PR, never a force-push.
- **Review gate.** Every PR is reviewed by a fresh-context, read-only subagent
  following `.github/REVIEW.md`. New subagent per round; it reads earlier
  rounds. Merge only after `VERDICT: APPROVE` on the final commit with CI green.
- **Session log.** Close every session with an entry in `docs/SESSION_LOG.md`:
  what was done, what was verified, what is pending, branch/commit/PR, next
  concrete action.
- **One PR at a time when PRs touch `CHANGELOG.md`.**
- **Verified state, with date and evidence.** Repository facts (rulesets, PVR,
  Pages) are recorded with the date and the command that showed them. Anything
  needing permissions you lack is recorded as _blocked_, never as done.

## Product rules the code must respect

- The PDF is never modified in place. Annotations live beside it and are
  exported into a copy.
- The raw transcript is always preserved; LLM clean-up is a separate, opt-in
  action and never silently reinterprets a critique.
- Before audio or document excerpts leave the device, the UI states what is
  sent and to which provider. Local-first is the default.
- Nothing is sent or published automatically.
- No unmeasured claims: STT accuracy and latency figures go in docs only with
  the dataset, parameters, provider version and date.
- Fail loudly: no silent fallbacks, no swallowed exceptions. Timestamps are
  UTC-aware and labeled as UTC.

## Conventions

- Components in `src/components/`, domain logic in `src/core/` (pure,
  framework-free, fully unit-tested), provider adapters in `src/providers/`.
- Tests sit next to the code as `*.test.ts(x)`.
- Keep `CHANGELOG.md` (`[Unreleased]` section) updated in the same PR as the
  change.
