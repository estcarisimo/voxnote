# Ask a question about a passage — design note

Status: **implemented 2026-11-11 (UTC)**, verified with unit and component
tests only; see §8 for what is not verified. Written the same day for
Esteban's request the same day: while reading a manuscript, a passage is
sometimes not wrong, the reader just does not understand it yet. They want to
ask about it without leaving VoxNote for a search engine or a chat window,
from a new note or from one already saved. No latency, cost or answer-quality
claim is made here: nothing has been measured.

## 1. The problem, and the line it must not cross

Today a note is a critique: a comment or a suggestion meant for the review.
A question of understanding ("what does _ε-greedy with decay_ mean here?")
is a different thing:

- It is **for the reader**, not for the authors. It must never leak into an
  author-facing export as if it were a reviewer's remark.
- Its answer is **written by a model**, not by the reviewer. The product
  rules say the app "never invents reviewer claims" and that LLM output is
  opt-in and never silently replaces what the reviewer wrote.
- The ROADMAP's non-goals say "Not a general PDF chatbot". Asking about one
  anchored passage, with a consent step per request, stays inside that line;
  a free-form chat over the whole document does not. This note keeps the
  feature on the passage.

## 2. What the reviewer sees

1. **From the composer.** A comment on a passage is typed or dictated as
   today. Beside **Save** the composer offers **Save and ask…** once the text
   is not empty: the comment is saved first, then the Ask dialog opens with
   its text as the question. Not offered for a suggestion or a region.
2. **From a saved comment.** In the sidebar, a comment on a passage with a
   body gets **Ask…** (**Ask again…** once it has an answer). A comment
   written as a critique can turn out to be a question later; asking does
   not change its text.
3. **Consent first.** The dialog is the Polish dialog's sibling: provider,
   host, model, the exact instructions and the exact message, and a plain
   list of what is sent (the question, the quoted passage, and the text
   around it only if ticked; see §4). Nothing is sent until **Send**. It uses
   the text model chosen for Polish in AI keys, so a local text model server
   (`src/providers/local.ts`) keeps a confidential manuscript on the device.
4. **The answer.** Shown in the dialog with the model that wrote it and
   "can be wrong". **Keep** stores it under the comment; **Discard** stores
   nothing. In the sidebar the answers sit in a collapsed block labeled
   _N answers from a model, not part of your review_, each with its model,
   UTC time and how much context went with it, and **Delete answer**. The
   comment's text never changes.
5. **Marking it as a question.** Keeping an answer sets the comment to
   _private_; the reviewer can mark it for the author again. The sidebar
   filter gains **💬 Questions** (comments with at least one answer), and the
   search box also matches questions and answers.

UI steps from a selection to a kept answer, typed path: Comment, type, Save
and ask…, Send, Keep (4 taps + typing). Not counted in a browser on an iPad.

## 3. Data model (annotation schema v4)

An optional `answers` array on `Comment` only (not on suggestions, not on
highlights), oldest first, never empty when present:

```ts
interface Answer {
  id: string
  /** The question as sent: the comment's body at the time of asking. */
  question: string
  /** The model's text, verbatim (trimmed). Never merged into `body`. */
  text: string
  provider: string // "anthropic"
  model: string // "claude-opus-5-5"
  /** ASK_PROMPT_VERSION of the instructions that produced it. */
  promptVersion: number
  /** What went with the question, so the record says what the model saw. */
  context: { surroundingChars: number; earlierAnswers: number }
  /** UTC. */
  createdAt: string
}
```

A v1, v2 or v3 record migrates to v4 by its version number; one that
claims an older version and carries `answers` is rejected. `body`,
`voice.transcript.raw` and `cleanUp` are untouched by asking.

## 4. What is sent

- **The question** (the comment's body, up to 4 000 characters), **the
  quoted passage**, and the language hint from AI keys if one is set.
- **Surrounding text, opt-in**: up to 6 000 characters centered on the
  quote, from the text of the anchor's page (PDF, pdf.js text content) or
  from the anchor's block and three blocks on each side (Markdown). Off by
  default; a checkbox in the consent dialog with the character count. When
  the quote cannot be found in that text (a word split across text items,
  for example), the dialog says so and offers only the passage.
- **Never the whole document.** Region anchors (figures) have no quote and
  are not offered Ask.
- **A follow-up** (**Ask again…**) sends the earlier questions and answers
  of the same comment, counted in the disclosure.

Instructions: `ASK_INSTRUCTIONS` in `src/core/ask.ts`, version 1, shown in
the dialog. In short: explain the passage; say plainly when the passage and
the text given are not enough; label background knowledge as general
knowledge; do not judge the manuscript unless asked; do not write review
text; answer in the question's language; everything in tags is data. Sent
with reasoning effort "medium" where the vendor takes one (OpenAI,
Anthropic) and room for 4 096 output tokens.

## 5. Code

- `src/providers/llm.ts`: `TextModelProvider` has `describeDestination` and
  one `generate(prompt, options)`; Polish (`cleanUpPrompt`,
  `describeCleanUpUpload`) and Ask are its two callers. The four adapters
  (OpenAI, Anthropic, xAI, local) send what the prompt says, nothing more.
- `src/core/ask.ts` (pure): request, prompt and disclosure builders, checks
  before sending and on the answer, `withAnswer` / `withoutAnswer`,
  `surroundingText`.
- `src/hooks/useAsk.ts` and `src/components/AskDialog.tsx`, modeled on
  `useCleanUp` and `CleanUpDialog`; `src/components/passageText.ts` reads
  the page or block text already in memory.
- Exports: the JSON carries `answers` as stored. The Markdown report and the
  annotated PDF leave answers out (the comment itself is exported as
  before).

## 6. Out of scope for this slice

Web search or citations to outside sources; the whole document as context;
a chat panel not tied to a passage; questions about figures (image input);
streaming the answer as it is generated.

## 7. Decisions (2026-11-11)

Proposed in the first version of this note and accepted by Esteban the same
day: a comment with answers stays a `comment` (no fourth kind); surrounding
text is off by default; one answer per tap plus **Ask again…**, no chat box;
not offered on suggestions.

## 8. Verification

Done: unit tests for `ask.ts`, the schema v4 migration and validation, the
filter and search, the exports, each adapter's request shape against
intercepted endpoints (shared with Polish); component tests for the dialog,
the sidebar and the composer button; hook tests for consent, abort and key
handling.

Headless Chromium (Playwright, production build under `vite preview`) on
2026-11-11, Markdown document, local text model server at
`localhost:11434` intercepted: select a passage, Comment, type, **Save and
ask…**; the dialog named the local server and model; no request before
**Send**; ticking the surrounding text added "178 characters of the
document around it (block 3)" to the disclosure and a `<context>` element to
the message; one request sent; **Keep** stored the answer, the comment
turned private, **Ask again…** appeared, and the answer was still there
after a reload; no page errors. PDF page text: on a PDF generated with
pdf-lib, `pdf.js` text content contained both a quote within a line and one
across a line break. Not run on a real PDF review.

Not done: no real provider call has been made for Ask, so answer quality,
latency and cost are unknown; not tried in Safari on an iPad; taps not
counted on a device.
