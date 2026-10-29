# Contributing to VoxNote

Thanks for your interest. VoxNote is early; the best contributions right now
are real-device reports (iPad + Pencil), STT evaluation samples, and PRs
against items in `ROADMAP.md`.

## Setup

```bash
npm install
npm run dev
```

`npm test`, `npm run lint`, `npm run format:check` and `npm run build` must all
pass before a PR.

## Rules

- Work on a feature branch and open a PR. Nothing is pushed to `main` directly,
  not even by maintainers.
- Every PR goes through the review protocol in `.github/REVIEW.md` and needs an
  explicit `VERDICT: APPROVE` plus green CI before merge.
- Update the `[Unreleased]` section of `CHANGELOG.md` in the same PR. Open only
  one changelog-touching PR at a time.
- American English in identifiers, docs, commit messages and PR text.
- Never commit API keys, recordings, or manuscripts. Test fixtures must be
  public-domain or synthetic PDFs.
- Performance or accuracy numbers go in docs only with the script, dataset,
  parameters, provider version and date that produced them.

## Commit messages

Imperative mood, under 72 characters on the first line, body explains why.
