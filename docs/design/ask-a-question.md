# Ask a question about a passage — design note

Status: **proposal, not implemented.** Written 2026-11-11 (UTC) for
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

1. **From the selection or the composer.** The note is typed or dictated as
   today. Next to **Transcribe…** and **Polish…** the composer offers
   **Ask…** once the body is not empty. The note's text is the question.
2. **From a saved note.** In the sidebar, a saved comment gets **Ask…** too,
   beside **Polish…**. A comment written as a critique can turn out to be a
   question later; asking does not change its body.
3. **Consent first.** The dialog is the Polish dialog's sibling: provider,
   host, model, the exact instructions and the exact input, and a plain list
   of what is sent (the question, the quoted passage, and the surrounding
   text only if ticked; see §4). Nothing is sent until **Send**. A local text
   model server (`src/providers/local.ts`) works here as it does for Polish,
   so a confidential manuscript can stay on the device.
4. **The answer.** Shown under the note, collapsed after the first read,
   labeled _Answer from anthropic/claude-… · 2026-11-11 14:03 UTC · not part
   of your review_. It is never copied into the body. **Ask again** (a
   follow-up) and **Delete answer** are the only actions on it.
5. **Marking it as a question.** Asking sets the note's visibility to
   _private_ unless the reviewer changes it back, and the sidebar filter gains
   **Questions** (notes with at least one answer).

UI steps from a selection to an answer, typed path: Comment, type, Ask…,
Send (3 taps + typing). Voice path with auto-transcribe on: Voice, Stop,
Ask…, Send (4 taps). Not counted in a browser yet.

## 3. Data model (schema v4)

An optional `answers` array on `Comment` (and on `Suggestion`, for symmetry,
though the UI offers Ask only on comments at first):

```ts
interface Answer {
  id: string
  /** The question as sent: a snapshot of the body at the time of asking. */
  question: string
  /** The model's text, verbatim. Never edited, never merged into `body`. */
  text: string
  provider: string // "anthropic"
  model: string // "claude-opus-5-5"
  /** ASK_PROMPT_VERSION of the instructions that produced it. */
  promptVersion: number
  /** What context went with it, so the record says what the model saw. */
  context: { quote: boolean; surroundingChars: number }
  /** UTC. */
  createdAt: string
}
```

A v3 record migrates to v4 with no `answers`. `body`, `voice.transcript.raw`
and `cleanUp` are untouched by asking.

## 4. What is sent

- **The question** (the note's body), **the quoted passage**, and the
  document's language if one is set.
- **Surrounding text, opt-in**: the text of the anchor's page (PDF) or of the
  blocks around it (Markdown), capped (proposal: 6 000 characters centered on
  the quote). Off by default; a ticked box in the consent dialog, with the
  character count. Many questions ("what does this symbol mean?") need the
  definition a paragraph earlier, so this matters for answer quality, and it
  is also the part that sends the most of an unpublished manuscript.
- **Never the whole document** in this slice. Region anchors (figures) have
  no quote; Ask is not offered on them until image input is designed.
- **A follow-up** sends the earlier question/answer pairs of the same note,
  listed in the consent dialog.

Instructions (draft, versioned as `ASK_PROMPT_VERSION = 1`): explain the
passage to a reader so they can understand it; answer the question asked;
say plainly when the passage and the context sent are not enough to answer;
do not judge whether the manuscript is right unless asked; do not write
review text; answer in the question's language. The question and the passage
travel inside tags, as data, the way `buildCleanUpInput` already does.

## 5. Code

- `src/core/ask.ts` (pure): request type, input builder, describe-parts for
  the disclosure, answer checks (non-empty, not truncated), `withAnswer`.
- `src/providers/llm.ts`: today `TextModelProvider` has one method,
  `cleanUp`. Generalize the four adapters (OpenAI, Anthropic, xAI, local)
  to one
  `generate({ instructions, input, maxOutputTokens }, options)`, and make
  `cleanUp` and `ask` callers of it. That refactor is the riskiest part and
  goes in its own PR before the feature.
- `src/hooks/useAsk.ts` and an `AskDialog` modeled on `CleanUpDialog`;
  buttons in `CommentComposer` and `AnnotationList`.
- Exports: JSON carries `answers` (export envelope bump). The Markdown report
  lists answers only under a separate **Questions (private)** section, and
  only when the reviewer ticks _Include my questions_; the annotated PDF never
  carries answers.

## 6. Out of scope for this slice

Web search or citations to outside sources; the whole document as context;
a chat panel not tied to a passage; questions about figures (image input);
streaming the answer as it is generated.

## 7. Open decisions

1. A note with answers stays a `comment`, or a fourth kind `question`?
   (Proposal: stays a comment; answers mark it. Cheaper, and a critique can
   become a question and back.)
2. Surrounding text off or on by default? (Proposal: off, per manuscript
   confidentiality.)
3. One answer per tap, or a running thread? (Proposal: one-shot plus **Ask
   again** with the earlier pairs; no chat box.)
4. Should Ask also be offered on suggestions? (Proposal: not at first.)

## 8. Verification plan

Unit tests for `ask.ts`, the migration and each adapter's request shape
against intercepted endpoints; component tests for the dialog and both entry
points; a headless Chromium run with the endpoints intercepted, counting the
taps above. Then at least one real call per provider, recorded with the
date, model and outcome, before any claim that it works.
