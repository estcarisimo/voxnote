# Crash recovery — design note

Status: **implemented** in the same PR as this note. Written 2026-11-07 (UTC)
for Esteban's request: a crashed tab, a tab killed by iOS, or an exception
must never make a reviewer start from zero.

## 1. What can be lost today, and the decision for each

| State                                                         | Where it lived before                              | Decision                                                                                                                                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saved highlights, comments, suggestions and their audio       | IndexedDB `annotations` + `audio`, on every change | **Already safe.** Writes resolve only after commit.                                                                                                                                                        |
| The opened document's bytes                                   | Memory only                                        | **Persist** in a new `documents` store (§2). Without it the user must find the same file again; a PDF opened from a link may not be reachable any more.                                                    |
| Which document was open, and where                            | Memory only                                        | **Persist** a one-record `session` store: document id, visible page, UTC timestamp. Cleared by **Close**, so it survives only an unclean exit.                                                             |
| Open composer: kind, anchor, placement, typed body            | React state                                        | **Persist** in a `drafts` store, one draft per document, debounced (400 ms) and flushed on `pagehide` / `visibilitychange: hidden`.                                                                        |
| A recording in progress                                       | `MediaRecorder` chunks in memory, emitted at Stop  | **Persist.** The recorder now emits a chunk every second; the composer writes the growing Blob into the draft (`complete: false`). After a crash it comes back as a recording that ends at the last chunk. |
| A finished recording not yet saved with a comment             | Object URL in memory                               | **Persist** in the draft (`complete: true`). It survives even if transcription never ran.                                                                                                                  |
| A transcript that arrived but whose comment was not yet saved | Composer state                                     | **Persist** in the draft: it was paid for, and the raw text must be preserved.                                                                                                                             |
| An accepted polish (clean-up) not yet saved                   | Composer state                                     | **Persist** with the draft, so a restored body that was polished still records which provider and model polished it, next to the raw transcript.                                                           |
| A transcription in flight                                     | A `fetch` in memory                                | **Accept the loss.** A request cannot outlive its page. The recording it was made from is in the draft, so the user taps Transcribe again; nothing is re-sent without that tap.                            |
| A polish proposal shown but not yet accepted                  | Dialog state                                       | **Accept the loss.** Same reasoning: the transcript it came from is persisted; re-asking is one tap and needs consent again by design.                                                                     |
| A transcript arriving for a comment already saved (auto mode) | A promise in memory                                | **Accept the loss.** The saved comment keeps its recording and shows **Transcribe…**.                                                                                                                      |
| UI prefs (tool, panel open, highlight color)                  | Color: `localStorage`; the rest: memory            | **Accept the loss** for tool and panel: one tap each to restore, and restoring a panel the user never wanted open is noise. The color was already persisted.                                               |
| A selection with only the toolbar showing (no composer)       | DOM selection                                      | **Accept the loss.** Nothing has been typed or recorded yet.                                                                                                                                               |

## 2. Schema (IndexedDB `voxnote`, version 3)

The upgrade only creates stores that are missing, so it is idempotent and keeps
v1/v2 data. `src/core/store.ts` exports the types; tests in `store.test.ts`.

- `documents`, keyPath `id`:
  `{ id: string /* SHA-256 hex of the bytes */, name: string, mimeType: string,
blob: Blob, size: number, openedAt: string /* UTC ISO 8601 */ }`.
  Written every time a document is opened (an existing record only gets its
  `name` and `openedAt` refreshed). This is the record a _recent documents_ list builds on:
  `listDocuments()` returns the metadata, newest `openedAt` first, without
  reading the bytes; `getDocument(id)` returns the Blob; `deleteDocument(id)`
  removes the bytes only (annotations and drafts stay, keyed by the same id).
- `session`, keyPath `key`, one record under key `"current"`:
  `{ key: "current", documentId: string, page: number | null, updatedAt: string /* UTC */ }`.
  `page` is the PDF page in view (null for Markdown).
- `drafts`, keyPath `documentId`:
  `{ documentId, mode: "typed" | "voice" | "suggest", anchor, placement,
body, audio?: { blob, mimeType, durationMs, recordedAt, complete },
transcript?, cleanUp?, updatedAt /* UTC */ }`. Validated on read; a corrupt
  draft is an error shown to the user, never silently dropped.

A failed write (quota, eviction) is shown in the app's error banner; the open
document stays usable, and the message says what will not be recoverable.

## 3. Behavior

- **Resume, on a tap.** On startup, if `session` names a stored document, the
  landing shows **Resume _name_** (and **Forget**). The app does not reopen it
  by itself: if that document is what crashed the tab (a pathological PDF, a
  render bug), an automatic reopen would crash again on every launch, with no
  way out short of clearing site data. One tap is the price of never looping.
- **Draft restored.** When a document opens and it has a draft, the composer
  reopens on its anchor with the body, the recording and the transcript, and
  shows **Draft restored (saved _time_ UTC)** with **Discard draft**. Save or
  Cancel deletes the draft; closing the document keeps it.
- **Errors never blank the app.** An error boundary around the viewer shows
  the message and **Reload**, and never touches IndexedDB; a second boundary
  wraps the whole app. `error` and `unhandledrejection` on `window` are shown in
  the existing error banner instead of only reaching the console.

## 4. Limits

- Storage quota is the browser's. Safari may evict script-written storage after
  seven days without a visit unless the app is installed to the home screen;
  this note does not change that, and no claim is made beyond it.
- A partial recording recovered after a crash may report no duration in some
  players (WebM chunks without a final cue index); it plays from the start.
- Verified on 2026-11-08 with `scripts/browser-crash-e2e.mjs` (headless
  Chromium 155.0.8059.84, `Page.crash` twice) with `BYPASS_SW=1`. Without
  that flag, a tab opened after the crash never finished its first
  navigation (twice, 20 s timeout): the service worker that lived in the
  crashed renderer looks like the cause, but this is not established, and
  it is unknown whether a real crash (not `Page.crash`) does the same. Open
  follow-up.
- iOS Safari's `MediaRecorder` with a timeslice has not been tested on a real
  device for this PR.
