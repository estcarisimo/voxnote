# Resuming a review: what to keep, what to load

Status: decided 2026-11-07. Scope: the portable answer that works across
browsers and devices. Same-browser crash recovery (the stored document bytes,
composer drafts, a "Resume" offer for the last open document) is a separate
piece and is not designed here.

## The question

"I was reviewing this document and want to continue. What do I load?"

Today VoxNote keeps annotations in this browser's IndexedDB, keyed by the
document id, the SHA-256 of the file's bytes. Reopening the same file in the
same browser brings the notes back. Anything else (another browser, another
device, cleared site data, a colleague's machine) loses them: there is no
import of any kind.

## Recommendation

**Keep two files: the original document and its `<name>.voxnote.json`
export. To continue anywhere, open the document, then Import notes… the
JSON.**

The JSON export already carries everything a review is made of except the
recordings: every annotation as stored (anchors, bodies, colors, visibility,
voice-note metadata, the raw transcript, the clean-up record), the document
id and its name. It is text, small, diffable, and readable without VoxNote.
The original PDF or Markdown file is something the user already has; VoxNote
never modifies it, so its id does not change.

What this slice builds:

- **Import notes…** on the landing and next to the exports. It reads a JSON
  export of any envelope version (v1 to v3) and annotation schema (v1 to v3,
  through `migrateAnnotation`), refuses anything invalid with a message that
  says what is wrong, and merges into IndexedDB for the document the file
  names: an id already present with identical content is skipped, an id
  present with different content is a conflict the user resolves (keep mine
  / take the file's), anything else is added. A summary says how many were
  added, skipped and in conflict. When that document is not the one open,
  the notes are still stored, and the summary names the file to open.
- **Export envelope v3**: adds the document's size in bytes and the app
  version. Name, id, kind, page or block count and the UTC export time were
  already there. The reader accepts v1 and v2 files.
- **Recent documents** on the landing: the documents with annotations in
  this browser (name, last annotated time in UTC, count), so the user knows
  which file to reopen. The name comes from a small `documentMeta` record
  (id, name, kind, lastAnnotatedAt) written in the same transaction as each
  annotation. Tapping an entry asks for the file; once crash recovery stores
  document bytes, it reopens from them through the `StoredDocuments` seam
  (`src/core/storedDocuments.ts`).

## Options weighed

### A self-contained review package (`.voxnote`, JSON + audio in a zip)

Deferred. It is the right next step, not the first one:

- **Size.** A minute of Opus or AAC audio is roughly 0.2 to 1 MB; a review
  with thirty voice notes is tens of MB, against a few kB of JSON. The JSON
  is what users will mail, commit next to a draft or attach to a ticket.
- **Privacy.** The JSON already goes to co-authors as a machine-readable
  report. A recording is the reviewer's voice, often franker than the typed
  body. Bundling it must be a separate, explicit choice ("Export review
  package, including N recordings"), not something every JSON export does.
- **Code.** A zip reader and writer is either a new dependency or a few
  hundred lines of our own (STORE-only zip, CRC-32), each with its own tests
  and size limits. Base64 audio inside the JSON would avoid that, but makes
  the readable file unreadable and a third larger.
- **What is lost without it.** The voice note stays described (duration,
  recording time, raw transcript); only replay and re-transcription need the
  audio. After an import, a voice note whose recording is not in this
  browser says so ("The recording is missing from local storage") instead
  of failing silently.

When it comes, the package is the JSON at the root plus `audio/<annotation
id>.<ext>`; Import notes… accepts both, so this slice's importer is the
package's importer minus the audio step.

### Re-importing the annotated PDF export

Not planned. The annotated PDF is for readers in other viewers; it is lossy
by design:

- Its bytes differ from the original, so its SHA-256 is a different document
  id. Re-importing would have to ask which original it belongs to, and could
  only check that by comparing page text.
- `/Contents` holds the rendered body (a suggestion is "original → body"),
  not the record: no visibility, no voice-note metadata, no raw transcript,
  no clean-up record, no creation time beyond `/M`, and Markdown documents
  have no annotated PDF at all. A round trip would silently degrade notes,
  which the product rules forbid.
- Viewers rewrite annotations they touch, and another tool's annotations sit
  next to ours; telling them apart rests on `/T` and `/NM`, both editable.

Reading _someone else's_ PDF annotations into VoxNote is a different feature
(import a co-reviewer's markup), with its own design; it is not how one
resumes one's own review.

## Deferred, in order

1. The `.voxnote` review package with recordings, as above.
2. Reopen from stored bytes in Recent documents, once crash recovery's
   `documents` store lands (the seam is in place; only the implementation of
   `StoredDocuments` changes).
3. A per-entry "Forget this document" in Recent documents (today the browser's
   site-data controls remove everything at once).
