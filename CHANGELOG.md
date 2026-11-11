# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Ask a question about a passage.** When a passage is not wrong but you
  do not understand it yet: write the question as a comment and tap **Save
  and ask…** in the composer, or **Ask…** on a saved comment in the
  sidebar. A consent dialog shows what is sent (the question, the quoted
  passage, and, only if ticked, up to 6 000 characters of the page or
  blocks around it), to which host and model, and the exact prompt; nothing
  leaves the device before **Send**. The answer is shown as a model's, and
  only **Keep** stores it, beside the comment, never in its text; the
  comment becomes private. **Ask again…** sends the earlier questions and
  answers too. The sidebar gains a **💬 Questions** filter and searches
  questions and answers. It uses the text model chosen for Polish, local
  servers included. Annotation schema v4 (`answers` on comments; older
  records migrate). The JSON export carries answers; the Markdown report
  and the annotated PDF leave them out. Design note:
  `docs/design/ask-a-question.md`. Verified with unit and component tests
  and one headless Chromium run against an intercepted local server
  (`scripts/browser-ask-e2e.cjs`); no real provider call has been made for
  it.
- **Local models.** Two new entries under **AI keys**, **Local
  speech-to-text server** and **Local text model server**, for a model you
  run yourself behind an OpenAI-compatible API: whisper.cpp
  (`whisper-server --inference-path /v1/audio/transcriptions --convert`),
  faster-whisper-server or LocalAI for transcription; Ollama, LM Studio,
  llama.cpp or vLLM for polish. Each takes a base URL (up to `/v1`), a model
  name and an optional key; VoxNote then calls
  `<base>/audio/transcriptions` or `<base>/chat/completions`. The consent
  dialogs name the server's address and say "on this device" only for a
  loopback address; the dialog warns when the browser will block a plain
  `http://` address from the https site; an unreachable server fails with
  the likely causes (not running, no CORS, mixed content). The README has a
  new "Local models" section, including how to use Superwhisper, which has
  no HTTP API, as a dictation keyboard. Verified with unit tests and in
  headless Chromium against a stand-in server; no real local model run
  recorded yet.

### Changed

- Text model adapters share one `generate()` call; Polish builds its own
  prompt and disclosure (`cleanUpPrompt`, `describeCleanUpUpload`). The
  requests and the disclosures Polish shows are unchanged.
- **Visit counting now shows up in Google Analytics.** The tag denied
  analytics storage, so GA4 sent only cookieless pings, which Google keeps
  for modeling and does not report for a site this small: from 2026-10-30
  the reports stayed empty. Analytics storage is now granted, so GA4 sets
  its first-party `_ga` cookies; ad storage, ad signals, Google signals and
  ad personalization stay off. The landing's privacy line and the README
  say so.
- **README status updated** with what has been tried on a real iPad (PWA
  install, Safari recording, a real transcription) and the exported PDF in
  other viewers, as reported by the maintainer on 2026-11-10; removed the
  stale note that a Markdown file cannot be opened from a link.

### Fixed

- **Picking a highlight color no longer loses the selection toolbar on a
  tap.** The toolbar lives only as long as the text selection under it, and
  a touch or Pencil tap on one of its buttons collapses that selection on
  iPadOS (canceling pointerdown keeps it through a mouse click only).
  Highlight and Comment act on the anchor at once, so they never noticed;
  a color pick left the viewer to re-read a selection that was gone. The
  toolbar now holds the selected range on press and puts it back after the
  tap, so a color pick followed by Highlight works in one pass.
- **Text selection and highlights line up on pages with a `/Rotate` entry.**
  pdf.js places every text layer span in the unrotated page frame and turns
  the whole layer with three stylesheet rules keyed on the
  `data-main-rotation` attribute it writes on the layer;
  `src/components/PdfPage.css` had no copy of them, so on a page stored
  sideways the canvas was drawn rotated and the text layer was not: no span
  sat on its glyphs, a selection ran across other lines, and a highlight
  landed away from the text. The stylesheet now carries pdf.js's three
  rules, scoped to the page's text layer, with the same values. The
  selection-to-PDF mapping (`src/components/geometry.ts`) already followed
  the page's rotation through the viewport, now covered by a test with a
  `/Rotate 90` page. Measured with `scripts/browser-text-layer-e2e.mjs`,
  which now maps each printed item through the rotated viewport, on
  2026-11-08 (UTC) in headless Chromium 155 against `npm run dev`, on the
  four-page PDF from the new `scripts/rotated-pages-pdf.mjs` (six lines a
  page, `/Rotate` 0, 90, 180 and 270): before, on the pages rotated 90 and
  270 the median span was 94 % shorter along the text than its glyphs and
  the worst span started 367 % and 600 % of its length away from them; at
  180 the lengths were right and the worst span started 321 % away. After,
  on every page the worst length error is 0.1 % and the worst start offset
  0.3 % of the text length; the unrotated page is unchanged (0.1 % and
  0.0 %). Logs: `docs/measurements/2026-11-08-rotated-text-layer/`.
- **Highlights on two-column pages no longer spill into the other column.**
  pdf.js sizes each text layer span through CSS variables it writes on the
  span (`--font-height`, `--scale-x`) and leaves the rules that apply them
  to its stylesheet; `src/components/PdfPage.css` had the layout rules but
  not those, so every span kept the browser's default 16 px font and no
  horizontal scaling. A span's glyph box was then wider than the printed
  line (about 30 % on a 9 pt two-column paper), the selection ran past the
  text, and a highlight's rectangles reached into the next column. The
  stylesheet now carries pdf.js's span sizing rules, and the page sets
  `--user-unit` next to `--scale-factor` as pdf.js's viewer does. Measured
  with the new `scripts/browser-text-layer-e2e.mjs` on 2026-11-08 (UTC) in
  headless Chromium 155 on page 2 of a two-column ACM paper (162 spans):
  before, the median span was 30 % wider than its text and the worst wide
  span 71 %; after, the median is 0.0 % and the worst wide span 0.8 %.
- **Large PDFs no longer freeze or crash the tab.** The viewer drew every
  page at once: canvas, text layer and all. Now only pages within one screen
  of the viewport hold a canvas and a text layer (an IntersectionObserver in
  `src/hooks/useNearPages.ts`). A page starts drawing after it has been near
  the screen for 80 ms, so a fast scroll skips the pages it passes. (pdf.js
  draws a page in ~15 ms slices, one per animation frame; with every page
  drawing, all their slices shared each frame, which made a frame a
  multi-second task.) A page that goes far releases its canvas (zero-size
  backing store) and text layer.
  Every page still takes its real height, so scroll positions hold, and the
  page under an open toolbar or composer stays rendered. Measured with the
  new `scripts/perf-e2e.mjs` on 2026-11-08 (UTC) in headless Chromium 155
  (`--disable-gpu`), 1180 x 820 at devicePixelRatio 2, on RFC 9000 (151
  pages), on a shared 8 GB Linux machine (load average 1.6 to 14.9 where
  logged): five
  runs of `main` (0d4dce2) and eight of this change (three alternating
  with `main`, one with the save count checked, two after merging `main`
  42c65b2, two on the final code). Raw logs and setup: `docs/measurements/2026-11-08-pdf-freezes/`.
  With `main`, the renderer crashed during the fast scroll in 3 of 5 runs.
  Canvas backing stores reached 2,638 MB; the first readable page took 15.9
  to 24.2 s with a longest task of 5.0 to 8.2 s; the two runs that survived
  the fast scroll blocked the main thread for 238 s and 293 s. With this
  change, no run crashed; canvases use 35 MB (53 MB once highlights are
  drawn); the first page is readable in 0.46 to 1.06 s, with a longest task
  of 53 to 84 ms; the fast scroll has 0 to 21 long tasks, the longest
  112 ms; and 30 highlights saved across the document (the header confirms
  **Annotations (30)** in the five runs that checked it) take a median of
  13 to 38 ms each, against 108 and 131 ms on the two `main` runs that got
  that far. Markdown documents were not affected: a 7,864-line file showed
  no long task while scrolling, saving or exporting, before or after. Not
  yet checked on a real iPad.
- **Resume returns to the page you were on.** The viewer sized its pages at
  a placeholder width of 600 px and corrected it a frame later, so the
  crash-recovery scroll to page N landed well before N. Pages taller than
  Letter shifted further, because a page's real height arrived after the
  scroll. The viewer now measures its width before the first paint, every
  page is marked `data-sized` once its real height is in, and the resume
  scroll waits for the target page and those above it. Checked on
  2026-11-08 (UTC) in headless Chromium 155 at 1180 x 820, DPR 1, with
  `docs/measurements/2026-11-08-pdf-freezes/resume-check.mjs`: open, scroll
  to page N, reload, **Resume**, then read the page at the top third of the
  viewer. On `main` (42c65b2) RFC 9000 page 120 came back as page 74 and an
  80-page A4 file's page 50 as page 31. With this change they came back as
  120, 50 and 7 (page 7 of the A4 file). With the width fix but without the
  `data-sized` wait, the A4 file's page 50 came back as 31 and 39.

### Added

- **Document zoom, apart from the browser's.** A floating control at the
  viewer's bottom-right corner zooms the PDF out, in (50% to 400% of the
  fit-to-width size, in 13 steps) or back to fit; Ctrl+wheel and a trackpad
  pinch over the pages zoom the document instead of the whole page, and
  Ctrl/Cmd with +, - or 0 do the same outside a text field. The point under
  the cursor (or the viewport's center) stays put across a zoom (the math in
  `src/core/zoom.ts`): a page's height now derives from its measured aspect
  ratio in the same render as its width, so the scroll position can be
  corrected before the browser paints. Highlights, the text layer and an
  open composer follow their anchor to the new size; a pending selection
  toolbar is dismissed, since its text selection does not survive the text
  layer redrawing. Zooming in past the container's width scrolls
  horizontally. The zoom is per open document and is not persisted.
- **Crash recovery: a crashed or killed tab no longer means starting from
  zero.** Design note: `docs/design/crash-recovery.md` (what can be lost,
  and the decision for each). IndexedDB moves to version 4 (after
  `documentMeta` at version 3) with an idempotent upgrade and three new
  stores (`src/core/recoveryStore.ts`, unit
  tested with fake-indexeddb): `documents` keeps the bytes of every opened PDF
  or Markdown file (id = SHA-256, name, MIME type, Blob, size, `openedAt`
  UTC; **Continue a review** now reopens a kept document in one tap through
  the `StoredDocuments` seam), `session`
  records the open document and the PDF page in view, and `drafts` keeps the
  open composer (kind, anchor, placement, body, the recording, its raw
  transcript and an accepted polish). On the landing, the first row of
  **Continue a review** is **Resume _name_**
  reopens the kept document after an unclean exit, on a tap only (an
  automatic reopen of the document that crashed the tab would crash it
  again), with **Forget its copy** to drop it; **Close** clears the session.
  The composer is written 400 ms after each change and at once when the page
  is hidden; the recorder now emits audio every second, so a recording
  survives even a crash mid-sentence, before Stop and before any
  transcription. Reopening the document brings the composer back with
  **Draft restored (saved … UTC)** and **Discard draft**. A failed write
  (quota) is shown in the error banner. An error boundary around the viewer
  (and one around the whole app) shows the error and **Reload** instead of a
  blank page, and never touches local storage; uncaught errors and unhandled
  promise rejections on `window` are shown in the error banner. Verified end
  to end with `scripts/browser-crash-e2e.mjs` (headless Chromium 155,
  `Page.crash` twice). README privacy section: what is kept and how to clear
  it.
- **Persistent storage.** The first write of each visit asks the browser not
  to evict VoxNote's data (`navigator.storage.persist()`, skipped when
  already persistent, never awaited before the session is written since
  Firefox may show a permission prompt; `src/core/keepDocument.ts`); the landing shows the outcome and the usage from
  `navigator.storage.estimate()` (`src/core/storagePersistence.ts`). A
  browser without the API is reported in the error banner instead of being
  treated as safe. The design note and README state Safari's seven-day
  eviction rule and the Home Screen exemption, with the WebKit sources and
  the date they were read.

### Changed

- **JSON export format 3.** The envelope adds the document's size in bytes
  and `app: { name, version }`; the reader still accepts formats 1 and 2.
- **The landing is generic about where a document comes from.** The link
  field is now **Or open from a link** and accepts a PDF or a Markdown file
  (a PDF by its `%PDF-` bytes whatever the path says; Markdown by a `.md` or
  `.markdown` path or a `text/markdown` content type, since Markdown has no
  magic bytes; an HTML content type is refused even at a `.md` path, with a
  message pointing at the raw file, so a forge's "blob" page is never
  reviewed as if it were the file); the placeholder and hint no longer
  mention RFCs, and the error for anything else names the content type
  without pointing at the IETF. The Internet-Draft flow moves from its own card to one sentence
  under the link field ("Reviewing an IETF Internet-Draft? Drop its .xml or
  pick it"), the first of what can become one line per source-specific
  converter; the consent dialog and its behavior are unchanged. The privacy
  note says that a file goes to a converter only when you confirm it in a
  dialog that names the service, instead of naming the IETF. Domain:
  `fetchDocument` in `src/core/remotePdf.ts` replaces `fetchPdf` for user
  links (`fetchPdf` stays for links a service returns, where the kind is
  known), `fileNameFromUrl` takes the extension, `looksLikeMarkdown` is new;
  all unit tested. README usage updated. `scripts/browser-e2e.mjs` gains a
  Markdown-by-link step; on 2026-11-05 it ran in headless Chromium 155
  against the live hosts: `rfc9000.pdf` opened (151 pages), the draft's
  `.txt` was refused with the no-CORS message, the repository's README
  opened from raw.githubusercontent.com as Markdown (15 headings), and the
  draft's XML compiled and opened (7 pages) after the consent dialog.

### Added

- **Continuing a review: Import notes… and Continue a review.** The answer
  to "what do I load to continue?" is the original file plus its JSON
  export; the decision, and why the annotated PDF is not re-imported and a
  `.voxnote` package with audio is deferred, is in
  `docs/design/resume-review.md`. **Import notes…** (on the landing, next to
  the exports, or by dropping a `.json` on the landing) reads a JSON export
  of any format (envelope v1 to v3, annotation schema v1 to v3), refuses an
  invalid file as a whole with the reason, and shows what it holds before
  writing: new notes are added, identical ones skipped, and for each note
  that differs the reviewer keeps theirs or takes the file's; a summary
  follows (added, skipped, conflicts, voice notes whose recording is not in
  this browser). Notes for a document that is not open are stored for it,
  and the summary offers to open that file. The landing lists the documents
  with notes in this browser (**Continue a review**: name, count, last
  saved time in UTC); tapping one asks for the file and says so if the
  picked file's content differs. Domain: `src/core/importNotes.ts`
  (parse, validate, plan, merge), a `documentMeta` object store in
  `src/core/store.ts` (IndexedDB version 3; existing annotations are
  backfilled with an unnamed record, named on the next open), `putMany`,
  `nameDocument` and `listDocuments` on the store, and the
  `src/core/storedDocuments.ts` seam where kept document bytes will plug
  in; all unit tested with `fake-indexeddb`. README: **Continuing a review**
  and the privacy note on what is stored.

- **Highlight colors.** A fixed palette of six colors (yellow, green, blue,
  pink, orange, purple; names and hex values in one place,
  `src/core/palette.ts`) shown as a row of colored dots in the selection
  toolbar, before **Highlight**. Tapping a dot picks the color of the next
  highlight and nothing else; the pick is remembered across reloads in
  `localStorage` (`voxnote.highlight.color`; a stored value outside the
  palette fails loudly instead of being guessed, and a pick that cannot be
  saved still applies, with the error shown). Each dot is a 44 px radio
  button named after its color, with a ring on the chosen one. Highlights
  draw on the page in their color, text runs and regions alike; the
  annotations panel shows the color beside the page number and offers the
  same dots to recolor a highlight afterwards, a failed write leaving the
  dots as they were. The exported PDF writes the color into each
  `/Highlight` and `/Square` annotation's `/C` array; the Markdown report
  names it next to the visibility; the JSON carries the `color` field.
  Annotation schema v3: `color` is required on highlights, and records
  stored as v1 or v2 load with the default yellow, the one color every
  highlight had before (unit tests for the migration in
  `src/core/annotations.test.ts` and `src/core/store.test.ts`). Verified on
  2026-11-05: 424 unit and component tests; a six-color export checked with
  `qpdf --check` (no errors) and rendered by poppler 25 (`pdftoppm`) in the
  six colors; and the production build driven in headless Chromium 155
  over DevTools (pick pink, highlight a region and a text run, recolor one
  to purple from the panel, reload: both colors back from IndexedDB, pink
  still picked, no console errors). Not yet tried in Safari on an iPad, nor
  in Preview, Acrobat or PDF Expert.

- **Review Markdown documents.** The landing's **Open a document** button
  (and a drop anywhere on the page) takes a `.md` or `.markdown` file as
  well as a PDF. The file is rendered in the browser and reviewed with the
  same tools: select a passage, then **Highlight**, **Comment**, **Voice** or
  **Suggest**; the Annotations panel, visibility, transcription and polish
  work unchanged; **Markdown** and **JSON** export the notes. Design and
  the routes weighed are in the ROADMAP's design note dated 2026-11-05.
  How it is built: `marked` (18.1.3) is used as a lexer only and its tokens
  become a restricted block tree (`src/core/markdown.ts`) that React
  renders itself, so no HTML from the file is ever injected: raw HTML shows
  as text, links keep `http(s):`, `mailto:` and relative targets while any
  other scheme (`javascript:` included) and protocol-relative `//host`
  targets render as plain text, and images are placeholders that are never
  fetched (loading one
  would call a third party without consent). A new anchor type,
  `block-text`, records the top-level block's ordinal, character offsets
  into the block's plain text and the quote; the renderer guarantees the
  block's `textContent` equals that plain text (component-tested), so an
  anchor resolves from stored data alone. Marks are drawn from DOM ranges
  after each layout and follow the window width; an anchor that no longer
  fits its block is reported in an alert, never dropped. Selections across
  two top-level blocks get no toolbar, like selections across two PDF pages.
  The annotation schema is v3, shared with the highlight palette's bump:
  `migrateAnnotation` rewrites a v1 or v2 record's version and gives a
  highlight the default color, and rejects an old record that already
  claims a color or a block-text anchor. The notes-export envelope is v2 (`document.kind`, with
  `blockCount` for Markdown where a PDF has `pageCount`). The sidebar and
  the Markdown report label a block anchor's position as "Block N" / "¶ N".
  The annotated-PDF export is hidden for Markdown documents, and
  `exportAnnotatedPdf` refuses a block-text anchor outright. The document id
  is the SHA-256 of the file's bytes, as for PDFs, so reopening the same
  file brings its annotations back. Verified on 2026-11-05 with unit tests
  for the parser, the plain-text contract, the selection bridge, the
  model, the review ordering and the exports, and component tests for the
  renderer and the viewer (toolbar on a single-block selection, highlight,
  typed comment and suggestion saved with block-text anchors, cross-block
  selections ignored, unplaceable anchors reported); not yet tried on an
  iPad or with a real voice note on a Markdown document. Not in this
  change: an annotated copy of the Markdown source with CriticMarkup marks,
  opening a Markdown file from a link, re-anchoring after the source changes.

- **Open a PDF from a link.** The landing has an "Or open a PDF from a
  link" field: paste an http(s) URL and tap **Open**, and the browser
  downloads the file straight from that site and opens it as if it had been
  picked. Nothing goes through any VoxNote server, and the site must allow
  cross-origin downloads (CORS). RFCs from rfc-editor.org do and the
  Internet-Draft archive at `www.ietf.org/archive/id/` does not (headers
  checked on 2026-11-05 with `curl -I` and an `Origin:` header; see the
  ROADMAP design note), and the error message says so and points at the XML
  flow below. A body that is not a PDF (an HTML or text page) is refused
  with its content type.
- **Open an Internet-Draft from its XML.** Drafts are published as text,
  HTML and XML, not PDF, so the landing offers **Open an Internet-Draft
  (XML)** (a dropped `.xml` takes the same path). A consent dialog states
  that the file, with its name and size, is uploaded to
  `author-tools.ietf.org`, the IETF's public author tools, which compile it
  with xml2rfc and return a PDF, and that nothing is sent until **Send** is
  tapped; Cancel aborts a request in flight. xml2rfc warnings are listed
  before the PDF opens, never hidden; errors keep the dialog open with the
  message verbatim. The returned link is followed only when it is on the
  same host. Domain logic in `src/core/remotePdf.ts` (URL parsing, file
  naming, the `%PDF-` check, the two-request author-tools exchange) is unit
  tested with an injected `fetch`. The link the service returns is followed
  only on the author-tools origin and without redirects. Text-only drafts
  are not supported: on 2026-11-05 author-tools' own text-to-XML conversion
  failed on `draft-ietf-quic-bit-grease-04.txt`, so the flow takes XML only.
  Both flows were run on 2026-11-05 in headless Chromium 155 against the
  live hosts with `scripts/browser-e2e.mjs` (production build served by
  `vite preview`): `rfc9000.pdf` opened with 151 pages, the draft's `.txt`
  was refused with the no-CORS message, and the draft's XML came back as a
  7-page PDF after the consent dialog, with two xml2rfc warnings listed.
- The ROADMAP records why diffs between draft versions stay out of scope
  for now (no IETF service returns a diff as PDF) and the two upstream
  changes that would make drafts openable by name.

- **Discoverability for search engines and AI agents**, the same pattern as
  the maintainer's other repositories (`llms.txt` plus `llms-full.txt`,
  `context7.json`, README links), adapted to a Vite site with no MkDocs:
  hand-written `public/llms.txt` (an index of the README, roadmap, changelog
  and design notes as raw Markdown, with the privacy and non-affiliation
  facts an agent should keep straight) and `public/llms-full.txt` (the
  project in one file, dated), `public/robots.txt` (every crawler allowed,
  sitemap named), `public/sitemap.xml` (the landing, no `lastmod`), a
  `<meta name="description">` in `index.html`, and `context7.json` at the
  root so Context7 indexes `docs/` and the root Markdown but not the source,
  tests or maintainer files. All are served under
  `https://estcarisimo.github.io/voxnote/` once `main` is deployed. A unit
  test checks the files exist, that their absolute URLs point at the live
  site or the repository and that `context7.json` fits the schema's limits.
  The README's new Discoverability section documents the manual Context7
  submission step; nothing is submitted by any workflow.
  The service worker's navigation fallback skips these four files
  (`navigateFallbackDenylist`), so a browser with the worker installed that
  opens `/voxnote/llms.txt` gets the file, not the app shell.

### Changed

- The optional LLM pass over a raw transcript is called **Polish** everywhere
  the user reads it, no longer "Clean up", which sounded like deleting:
  **Polish…** / **Polishing…** buttons in the composer and the Annotations
  panel, the dialog titles "Polish this transcript with <provider>?" and
  "Review the polished text", the "Polished with provider/model" label in
  the panel, "(polished with …)" in the Markdown export and "[Text polished
  with …]" in the PDF note, "Polish" as a key's role and "Polish model" /
  "Use for polish" in the AI keys dialog, the disclosure part "the polishing
  instructions shown under Prompt", and the error messages. Copy only: the
  stored `cleanUp` record, the code identifiers and the prompt text
  (`CLEAN_UP_INSTRUCTIONS`, still version 1) are unchanged.
- The landing view has a **Get started** section under the privacy note:
  three steps (an API key from Deepgram, Groq or OpenAI; optionally
  Anthropic, OpenAI or xAI to polish notes; paste it in AI keys) with text
  links to the vendors' key pages, opening in a new tab with
  `rel="noopener noreferrer"`, and a fixed line that VoxNote is not
  affiliated with any of them, that you pay them directly and that audio goes
  from your device to the provider you chose. No prices on the landing;
  nothing is fetched from any provider host. The README's configuration
  section gets a provider table with roles, default models, the
  pay-as-you-go audio prices and free-credit statements as the vendors'
  pages stated them on 2026-10-30, each with its source URL.
- Key management redesigned for reviewers who have never heard the word
  "provider": the header button is now a key icon labeled **AI keys**
  (44 px touch target), and the dialog of the same name lists the keys
  stored in this browser, one row per provider, with what each is used for
  (speech-to-text, polish or both), the model select for the role it
  serves, and a trash button that asks **Remove** / **Keep** inline before
  deleting the encrypted key. An empty state says keys stay in this browser
  and are needed only to transcribe or polish. **Add key** opens an inline
  row whose provider select lists only providers without a key, labeled by
  what they do; Save validates a non-empty key and collapses the row. When
  more than one stored key can serve a role, a compact **Use for polish**
  (or **Use for speech-to-text**) select picks which; with one candidate the
  choice is implicit and shown as text. Adding the first key that can serve
  a role picks it; removing the key in use moves the role to the next stored
  key. A saved key is never shown again, not even its length: a fixed "••••"
  stands in. Error messages that said "under Providers" now say "in AI
  keys". The language hint stays as one small field at the bottom.

### Added

- Transcribe on Stop, under a standing consent per document. The
  transcription dialog offers **Also do this automatically for this
  document** (off by default) with the sentence "From now on, each recording
  in this document is sent to <provider> at <host> as soon as you tap Stop."
  Once granted, Stop uploads at once through the same request path (one
  request at a time, Cancel aborts it, closing or switching the document
  settles it); the composer shows **Transcribing…** with **Cancel
  transcription**, and **Save** works before the transcript returns: the
  saved comment gets it on arrival, or the panel shows the error. The
  composer shows **Auto-transcribe: on**, and one tap turns it off; the
  AI keys dialog turns it off everywhere. A provider, model or language
  change, or removing the key, revokes it. Stored in localStorage
  (`voxnote.stt.autoTranscribe`) with the provider, model, host, language
  hint, quote choice, the exact disclosure shown and a UTC grant time, never
  in an annotation. Another document starts without it.
- Design note for live transcription while recording
  (`docs/design/live-transcription.md`): provider streaming endpoints,
  capture, consent, fallback, raw-transcript rules and phasing. Not
  implemented.

- The GitHub mark links to the repository from the top-right corner of the
  landing view and from the far right of the app bar while reviewing, so the
  code is one tap away. The mark is the official monochrome form, inline SVG
  in the text color, no extra request. The app-bar mark hides below 900 px
  wide (iPad portrait), where the bar has no room. The footer's "Repository"
  text link is gone; "Open source, MIT" and the license link stay.
- Two more speech-to-text providers, so transcription is no longer
  OpenAI-only: **Deepgram** (`nova-3` default, `nova-2`; pre-recorded
  `POST api.deepgram.com/v1/listen` with the raw recording as the body,
  `Authorization: Token`, `punctuate=true` only, never `smart_format` or
  any option that rewrites words; `detect_language=true` when no language
  hint is set, since Deepgram otherwise assumes English) and **Groq**
  hosted Whisper (`whisper-large-v3-turbo` default, `whisper-large-v3`;
  OpenAI-compatible multipart upload to `api.groq.com`, Bearer auth). Each
  has its own encrypted key; a key is only ever read for, and sent to, the
  provider shown in the consent dialog. Deepgram has no prompt parameter,
  so the quote-hint checkbox is not offered for it. Request shapes taken
  from the vendors' docs read on 2026-10-30; verified with unit tests and a
  headless run with both endpoints intercepted. **No real Deepgram or Groq
  call has been made.**
- Landing view redesigned so a first visit explains the app: the app icon,
  the tagline, one sentence on what VoxNote does, the **Open a PDF** button
  with the drop hint, a three-item row (Highlight, Comment by voice, Suggest
  a replacement), a plain-words privacy line, an install hint hidden when
  the app already runs standalone, and a footer linking the repository and the MIT
  license. The file picker and drag-and-drop are
  unchanged.
- Visit counting with Google Analytics 4, decided 2026-10-29 with strict
  limits: the measurement id comes from the build-time variable
  `VITE_GA_MEASUREMENT_ID` (on GitHub Pages, a repository variable of the
  same name); unset means no script is loaded and no request leaves the
  browser. When set, gtag.js loads from the landing view only, sends a
  single `page_view`, no custom events, never a file name, document id,
  annotation or transcript; consent defaults deny analytics and ad storage
  and every ad signal, so no cookies are set. The landing privacy line says so.
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
- App-driven pen text selection: a pen drag over the text layer builds the
  selection itself and cancels the pen's touch pan, for Apple Pencil on
  iPad, where native selection did not respond to a Pencil drag. Verified
  headless with emulated pen events; real-iPad confirmation pending. Touch
  and mouse keep native selection.
- **Highlights** panel listing annotations with jump-to-page and delete.
- **Export PDF**: writes a copy with native `/Highlight` and `/Square`
  annotations (pdf-lib); the original file is never modified.
- Comments: the selection toolbar now offers **Highlight**, **Comment** and
  **Voice** for text selections and regions. A typed comment needs no
  provider. A voice comment records with the microphone (record, stop,
  replay, re-record); the audio stays on this device in IndexedDB and can be
  replayed from the panel. Comment bodies are editable in the panel.
- Speech-to-text adapter interface (`src/providers/stt.ts`) with the
  disclosure hook every provider must implement.
- OpenAI transcription provider (`gpt-transcribe` by default; the older
  `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` and `whisper-1` selectable).
  **Providers** dialog to store your own API key, pick the model and set an
  optional language hint. The key is AES-GCM encrypted at rest with a
  non-extractable key kept in IndexedDB on this origin; it is sent only in
  the request you confirm, straight to the provider. VoxNote has no server.
- **Transcribe…** on a fresh recording or on a stored voice note opens a
  consent dialog that states exactly what is sent (the recording, optionally
  the quoted passage as a vocabulary hint, the language hint) and to which
  host. Nothing is uploaded until **Send** is tapped. The raw transcript is
  stored verbatim; it fills the comment body only when nothing was typed and
  stays visible read-only next to the editor.
- Exported comments carry their text in `/Contents`, so PDF viewers show them
  as notes. Audio is not embedded in the export.
- Suggestions: **Suggest** in the selection toolbar (text selections only)
  opens the selected text for editing in place, Google Docs style, typed or
  dictated; saving needs an actual change. The panel shows the original
  struck through and the replacement inserted, editable. Exported as native
  `/StrikeOut` annotations over the original with "Replace with: …" in the
  note. The PDF itself is never changed.
- Export group in the header: **Export PDF**, **Markdown** and **JSON**. The
  Markdown report (`<name>.voxnote.md`) lists annotations page by page, top
  to bottom, with the quoted passage or region, comment bodies, suggestions as
  original and replacement, and voice notes with duration and the raw
  transcript marked as raw; the export time is labeled UTC. The JSON export
  (`<name>.voxnote.json`) holds the document name, SHA-256 id and page count
  and the annotations exactly as stored, without audio. Both are generated in
  the browser and only downloaded; nothing is uploaded.
- Installable PWA: web app manifest, VoxNote icons (SVG plus PNG, maskable
  and Apple touch) and an offline app shell precached by a service worker
  (`vite-plugin-pwa`); a new version waits behind a dismissible "Update
  available — Reload" bar. Not yet tried on an iPad.
- Review sidebar: the **Annotations** panel groups annotations by kind,
  visibility or page (reading order within each group), filters them by kind,
  visibility, untranscribed voice notes and free text across quotes, notes
  and raw transcripts, and shows how many of the total are shown. Each
  annotation can be marked **Private** or **For author**; this is stored
  metadata for now, the exports do not filter on it yet. Tapping an
  annotation scrolls to its marks when its page has rendered, else to the
  page.
- Optional LLM polish of a dictated note, a separate opt-in action:
  **Polish…** (first shipped as "Clean up…") appears next to a raw transcript in the composer and in the
  **Annotations** panel. It sends the raw transcript (never the edited body),
  optionally the quoted passage as a spelling hint, and the language hint to
  the chosen text provider, after a consent dialog that names the host and the
  model and shows the exact prompt (`CLEAN_UP_INSTRUCTIONS`, version 1, in
  `src/providers/llm.ts`). Nothing is sent until **Send**; **Cancel** aborts
  the request. A review step shows the raw transcript and the proposal side by
  side; only **Accept** changes the note, **Discard** changes nothing. An
  empty, unchanged, or wildly longer or shorter answer is rejected with an
  error instead of being proposed (`CLEAN_UP_LENGTH_LIMITS`: within 20
  characters, or 50–150% of the raw length). The raw transcript is never
  modified.
- Text-model providers behind one `TextModelProvider` interface: OpenAI
  (Responses API; `gpt-6.1-terra` default, `gpt-6-luna`, `gpt-6.1-sol`,
  `gpt-6-astra`), Anthropic (Messages API; `claude-opus-5-5` default,
  `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`) and xAI
  (Responses API; `grok-4.7` default, `grok-4.6`,
  `grok-4.20-0309-non-reasoning`). Model ids as listed in each vendor's
  documentation on 2026-10-29. Verified against mocked endpoints only: no
  real provider call has been made.
- **Providers** lists speech-to-text and polish separately, each with its
  own provider and model; keys are kept one per provider (OpenAI's key serves
  both), each encrypted at rest as before.
- A polished body is marked as such: in the panel ("Polished with
  provider/model", "then edited" once changed by hand), in the Markdown
  export's label, and in the PDF note, which then also carries the raw
  transcript labeled as raw.
- GitHub Pages deployment: `.github/workflows/pages.yml` builds on every push
  to `main` (or on demand) and publishes the static build to
  <https://estcarisimo.github.io/voxnote/>; production builds and
  `npm run preview` use the `/voxnote/` base path.
- README rewritten to the maintainer's standard (badges, features with
  caveats, usage, privacy, configuration, architecture, about the name);
  CodeQL code scanning and a Security workflow (weekly `npm audit`, zizmor on
  the workflows); workflow checkouts no longer persist credentials.

### Changed

- Speech-to-text adapters declare `acceptsPrompt`; the consent dialog
  shows the quote hint only for providers that take one, and a request
  with a prompt to one that does not is refused before anything is sent.
  The OpenAI adapter now shares its file naming, size wording and key
  redaction with the new adapters (`src/providers/stt-http.ts`); error
  text also redacts the exact key that was sent, for every provider.
- The **Highlights** panel is now **Annotations** and lists comments with
  their quote, body and voice badge.
- IndexedDB schema version 2 adds an `audio` object store; version 1
  databases upgrade in place.
- Annotation schema version 2 adds the optional `cleanUp` record
  (`provider`, `model`, `createdAt` in UTC, `promptVersion`, `editedAfter`)
  on comments and suggestions. Version 1 records are read as version 2
  without changes to their content and rewritten on the next save.
- The session log moved from `docs/SESSION_LOG.md` to the project's Notion
  page; the repository only links to it.

### Fixed

- Stray selection box at the top-left corner of a page while selecting text.
