# Pull request review protocol

This file is the brief for the read-only review subagent that gates every PR.

## Rules for the reviewer

- You are read-only. Do not run any git command that touches the working tree
  (no checkout, stash, reset, rebase, merge, commit). `git diff`, `git log` and
  `git show` are fine.
- Read the earlier review rounds in the PR comments before starting.
- Read `AGENTS.md` and `ROADMAP.md` for the rules the code must respect.

## Checklist

1. **Correctness.** Does the change do what the PR says? Look for edge cases:
   PDFs with no text layer, empty selections, rotated pages, zero-length audio,
   provider errors, missing API key.
2. **Product rules.** PDF never modified in place; raw transcript preserved;
   disclosure before data leaves the device; nothing sent automatically; no
   secrets in code or logs.
3. **Tests.** New domain logic in `src/core/` has unit tests. Tests are
   deterministic. No claims in docs without evidence.
4. **Types and lint.** `npm run build`, `npm run lint`, `npm test` pass (check
   CI). No `any` without a comment explaining why.
5. **Hygiene.** `CHANGELOG.md` `[Unreleased]` updated. American English in
   identifiers and docs. No unrelated changes.

## Verdict

End the review with exactly one line:

- `VERDICT: APPROVE` — mergeable as is.
- `VERDICT: REQUEST_CHANGES` — list each blocking item with file and line.

Post the full review as a PR comment. The author records the number of rounds
in `docs/SESSION_LOG.md`.
