# PDF freezes: measurements of 2026-11-08 (UTC)

The raw output behind the "Large PDFs no longer freeze or crash the tab" and
"Resume returns to the page you were on" entries in `CHANGELOG.md` (PR #32).
Each `.log` line is one JSON record as `scripts/perf-e2e.mjs` printed it.
`<scratch>` replaces the local scratch directory that held the input files.

## Setup

- Headless Chromium 155.0.8059.84 (Arch Linux) with
  `--headless=new --no-sandbox --disable-gpu`. Rasterizing is in software,
  so absolute times are pessimistic next to a GPU-backed browser.
- Perf runs: window 1180 x 820 at devicePixelRatio 2 (an iPad Air's size),
  `HIGHLIGHTS=30`. Resume runs: 1180 x 820, DPR 1.
- Machine: Linux, 8 GB of RAM, shared with other sessions; the load average
  (1/5/15 min) is printed at each run in `runs-1-3.log` and ranged from 1.3
  to 16.
- Documents: RFC 9000 as PDF (151 Letter pages, 1,535,216 bytes, from
  rfc-editor.org) and as Markdown (`rfc9000.md` from the quicwg/base-drafts
  repository, 7,864 lines). An 80-page A4 PDF made by `make-a4-pdf.mjs`
  (pdf-lib).
- Builds: `main` at 0d4dce2 (before the crash-recovery merge) and 42c65b2
  (after it), and this branch at its commit for each run (noted per file).

## Files

| File                      | What                                                                                                                      | Builds                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `runs-1-3.log`            | Three alternating PDF runs, 00:34 to 01:12 UTC                                                                            | `main` 0d4dce2 vs branch 88ef6b6                         |
| `rerun-save-count.log`    | One branch run, two `main` runs, 01:19 to 01:41 UTC, with the save step requiring the header to read **Annotations (30)** | `main` 0d4dce2 vs branch 87b9b66                         |
| `merged-main-42c65b2.log` | Two branch runs after merging `main` 42c65b2, 02:00 UTC                                                                   | branch fd5a99e                                           |
| `markdown.log`            | Two runs per build on the Markdown file, 00:25 UTC                                                                        | `main` 0d4dce2 vs branch 88ef6b6                         |
| `resume.log`              | Open, scroll to page N, reload, **Resume**, page at the top third of the viewer, 02:01 to 02:02 UTC (`resume-check.mjs`)  | `main` 42c65b2 (port 4193) vs branch fd5a99e (port 4191) |

`Inspector.targetCrashed` lines in the PDF logs are renderer crashes; a
`main` run that crashed has no rows after the crash.

`resume-ablation.log` repeats the A4 page-50 resume twice on a local build
of fd5a99e with the `data-sized` wait disabled (the width fix kept), at
02:03 UTC: it came back as pages 31 and 39.
