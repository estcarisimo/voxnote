import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AnnotationList,
  type TranscriptArrival,
} from './components/AnnotationList'
import { AskDialog } from './components/AskDialog'
import { CleanUpDialog } from './components/CleanUpDialog'
import { markdownBlocksText, pdfPageText } from './components/passageText'
import { ErrorBoundary } from './components/ErrorBoundary'
import { deliverTranscript } from './components/deliverTranscript'
import { baseName, downloadFile } from './components/download'
import { ExportMenu, type ExportFormat } from './components/ExportMenu'
import { GitHubLink } from './components/GitHubLink'
import { ImportNotesDialog } from './components/ImportNotesDialog'
import type { RecentDocument } from './components/RecentDocuments'
import {
  MarkdownViewer,
  type MarkdownViewerHandle,
} from './components/MarkdownViewer'
import { OpenPdf, type Resumable } from './components/OpenPdf'
import {
  PdfViewer,
  type NewNoteRequest,
  type PdfViewerHandle,
} from './components/PdfViewer'
import type { Tool } from './components/PdfPage'
import { ProviderSettings } from './components/ProviderSettings'
import { RenderDraftDialog } from './components/RenderDraftDialog'
import { TranscribeDialog } from './components/TranscribeDialog'
import {
  quoteOf,
  type Anchor,
  type Annotation,
  type Answer,
  type Comment,
  type Highlight,
  type Note,
  type Transcript,
  type Visibility,
} from './core/annotations'
import { surroundingText } from './core/ask'
import { placeLabel } from './core/review'
import type { HighlightColor } from './core/palette'
import {
  exportJson,
  exportMarkdown,
  validatedAndSorted,
  type ExportDocument,
} from './core/exportNotes'
import { exportAnnotatedPdf } from './core/exportPdf'
import {
  MAX_NOTES_FILE_BYTES,
  applyMerge,
  labelOf,
  parseNotesFile,
  planMerge,
  type ImportSummary,
  type MergePlan,
  type NotesFile,
  type Resolutions,
} from './core/importNotes'
import {
  isMarkdownFile,
  parseMarkdown,
  type MarkdownDocument,
} from './core/markdown'
import {
  computeDocumentId,
  destroyDocument,
  isPdfFile,
  loadDocument,
  type PDFDocumentProxy,
} from './core/pdf'
import { keepOpenedDocument } from './core/keepDocument'
import type { RecoveryStore } from './core/recoveryStore'
import { fetchDocument } from './core/remotePdf'
import {
  openAnnotationStore,
  type AnnotationStore,
  type DocumentLabel,
} from './core/store'
import {
  NO_STORED_DOCUMENTS,
  storedDocumentsFrom,
} from './core/storedDocuments'
import { useAnnotations } from './hooks/useAnnotations'
import { useAutoTranscribeConsent } from './hooks/useAutoTranscribeConsent'
import { useAsk } from './hooks/useAsk'
import { useCleanUp } from './hooks/useCleanUp'
import { useDraft } from './hooks/useDraft'
import { useHighlightColor } from './hooks/useHighlightColor'
import { useProviders } from './hooks/useProviders'
import { useRecoveryStore } from './hooks/useRecoveryStore'
import { useStorageStatus } from './hooks/useStorageStatus'
import { useSessionPage } from './hooks/useSessionPage'
import { useWindowErrors } from './hooks/useWindowErrors'
import { AiKeysButton } from './components/AiKeysButton'
import { useTranscription } from './hooks/useTranscription'
import './App.css'

/** How a document is opened: the file a resume expected, the page to show. */
interface OpenOptions {
  expected?: ExpectedDocument | null
  /** PDF page to scroll to once laid out (crash resume). */
  resumePage?: number | null
}

/**
 * The open document: its SHA-256 id, its file name, its size in bytes and
 * its parsed form.
 */
type OpenDocument =
  | {
      kind: 'pdf'
      id: string
      name: string
      size: number
      bytes: Uint8Array
      pdf: PDFDocumentProxy
    }
  | {
      kind: 'markdown'
      id: string
      name: string
      size: number
      markdown: MarkdownDocument
    }

/** A file the user was asked to open, to check the one they pick. */
interface ExpectedDocument {
  id: string
  name: string | null
}

/** A parsed notes file waiting for the user to confirm the merge. */
interface PendingImport {
  fileName: string
  notes: NotesFile
  plan: MergePlan
}

function exportInfo(doc: OpenDocument): ExportDocument {
  return doc.kind === 'pdf'
    ? {
        kind: 'pdf',
        name: doc.name,
        id: doc.id,
        size: doc.size,
        pageCount: doc.pdf.numPages,
      }
    : {
        kind: 'markdown',
        name: doc.name,
        id: doc.id,
        size: doc.size,
        blockCount: doc.markdown.blocks.length,
      }
}

function release(doc: OpenDocument | null) {
  if (doc?.kind === 'pdf') void destroyDocument(doc.pdf)
}

function App() {
  const [doc, setDoc] = useState<OpenDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // An Internet-Draft's XML waiting for consent to be compiled into a PDF.
  const [draftXml, setDraftXml] = useState<File | null>(null)
  const recovery = useRecoveryStore()
  // Where a resumed document's bytes come from: crash recovery's store.
  const storedDocuments = useMemo(
    () =>
      recovery.store
        ? storedDocumentsFrom(recovery.store)
        : NO_STORED_DOCUMENTS,
    [recovery.store],
  )
  const drafts = useDraft(doc?.id ?? null, recovery)
  // The document that was open when the page last went away, if kept.
  const [resumable, setResumable] = useState<Resumable | null>(null)
  useWindowErrors(setError)
  const storage = useStorageStatus()
  // The document whose copy is kept: only it may be named by the session.
  const [keptId, setKeptId] = useState<string | null>(null)
  // The open document's id, set in the same tick as open and close, for
  // writes that finish after either.
  const openIdRef = useRef<string | null>(null)
  useSessionPage(
    recovery.store,
    doc?.kind === 'pdf' && doc.id === keptId ? doc.id : null,
    setError,
  )
  const viewerRef = useRef<PdfViewerHandle>(null)
  const markdownViewerRef = useRef<MarkdownViewerHandle>(null)
  const docLabel = useMemo<DocumentLabel | undefined>(
    () => (doc ? { name: doc.name, kind: doc.kind } : undefined),
    [doc],
  )
  const store = useAnnotations(doc?.id ?? null, docLabel)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [recent, setRecent] = useState<RecentDocument[]>([])
  // Bumped after a write the landing list must show.
  const [recentVersion, setRecentVersion] = useState(0)
  const documentPickerRef = useRef<HTMLInputElement>(null)
  const notesPickerRef = useRef<HTMLInputElement>(null)
  // The file the user was last asked for (Recent documents, an import).
  const expectedRef = useRef<ExpectedDocument | null>(null)
  const highlightColor = useHighlightColor()
  const providers = useProviders()
  const autoConsents = useAutoTranscribeConsent(providers)
  const transcription = useTranscription(providers, {
    documentId: doc?.id ?? null,
    store: autoConsents,
  })
  const cleanUpFlow = useCleanUp(providers)
  const askFlow = useAsk(providers)
  // Transcripts still on their way to comments saved before they arrived.
  const [arrivals, setArrivals] = useState<
    Readonly<Record<string, TranscriptArrival>>
  >({})
  // The open document's id as of the last render, for checks after an await.
  const docIdRef = useRef<string | null>(null)
  // The latest store: a transcript arriving later must see the saved note.
  const storeRef = useRef(store)
  useEffect(() => {
    docIdRef.current = doc?.id ?? null
    storeRef.current = store
  })

  // On the landing, offer the document of an unclean exit. Close clears the
  // session, so this only finds one after a crash, a kill or a reload.
  const landing = doc === null
  const refreshStorage = storage.refresh
  useEffect(() => {
    if (!landing) return
    refreshStorage().catch((err: unknown) => {
      setError(`Could not read the storage status: ${messageOf(err)}`)
    })
    const store = recovery.store
    if (!store) return
    let live = true
    findResumable(store).then(
      (found) => live && setResumable(found),
      (err: unknown) =>
        live && setError(`Could not read the last session: ${messageOf(err)}`),
    )
    return () => {
      live = false
    }
  }, [recovery.store, landing, refreshStorage])

  // A restored draft on a region reopens with the Region tool, so its
  // composer is not dropped as belonging to another tool.
  const [toolSetFor, setToolSetFor] = useState<string | null>(null)
  if (doc && drafts.ready && toolSetFor !== doc.id) {
    setToolSetFor(doc.id)
    if (drafts.restored?.anchor.type === 'region') setTool('region')
  }

  /** Keeps the bytes and the session so a crash can be resumed. */
  function keepDocument(
    opened: OpenDocument,
    bytes: Uint8Array,
    mimeType: string,
    page: number | null,
  ) {
    // The store may still be opening (a slow device): wait for it, so the
    // first document of a visit is kept too. A failed open is already shown.
    void recovery.whenOpen().then((store) => {
      if (!store) return
      void keepOpenedDocument(
        { id: opened.id, name: opened.name, mimeType, bytes, page },
        {
          store,
          isStillOpen: () => openIdRef.current === opened.id,
          ensurePersistent: storage.ensurePersistent,
          onKept: setKeptId,
          onError: setError,
        },
      )
    })
  }

  /** Reopens the document of an unclean exit, at its page. */
  async function resumeInterrupted(target: Resumable) {
    const store = recovery.store
    if (!store || loading) return
    setError(null)
    try {
      const stored = await store.getDocument(target.documentId)
      if (!stored) throw new Error('it is no longer kept on this device')
      const file = new File([stored.blob], stored.name, {
        type: stored.mimeType,
      })
      await openFile(file, {
        expected: { id: target.documentId, name: target.name },
        resumePage: target.page,
      })
    } catch (err: unknown) {
      setError(`Could not resume "${target.name}": ${messageOf(err)}`)
    }
  }

  async function forget(target: Resumable) {
    const store = recovery.store
    if (!store) return
    try {
      await store.clearSession()
      await store.deleteDocument(target.documentId)
      setResumable(null)
      // Its row in Continue a review now asks for the file again.
      setRecentVersion((v) => v + 1)
    } catch (err: unknown) {
      setError(`Could not forget "${target.name}": ${messageOf(err)}`)
    }
  }

  async function transcribeStored(comment: Note) {
    if (!comment.voice) throw new Error('This comment has no recording')
    const audio = await store.getAudio(comment.id)
    if (!audio) throw new Error('The recording is missing from local storage')
    if (docIdRef.current !== comment.documentId) {
      throw new Error('The document changed; open it again to transcribe')
    }
    const transcript = await transcription.request({
      audio,
      mimeType: comment.voice.mimeType,
      durationMs: comment.voice.durationMs,
      quote: quoteOf(comment.anchor),
    })
    if (transcript) await store.setTranscript(comment.id, transcript)
  }

  async function cleanUpStored(note: Note) {
    const transcript = note.voice?.transcript
    if (!transcript) throw new Error('This note has no raw transcript')
    const proposal = await cleanUpFlow.request({
      transcript: transcript.raw,
      kind: note.kind,
      quote: quoteOf(note.anchor),
      currentBody: note.body,
    })
    if (!proposal) return
    if (docIdRef.current !== note.documentId) {
      throw new Error('The document changed; the polished text was not applied')
    }
    await store.applyCleanUp(note.id, proposal)
  }

  /**
   * Asks about a saved comment's passage, with its body as the question.
   * The text around the passage is read here and offered in the dialog;
   * it is only sent if the reviewer ticks it there.
   */
  async function askStored(comment: Comment) {
    const quote = quoteOf(comment.anchor)
    if (quote === null) throw new Error('A region has no passage to ask about')
    if (!doc || doc.id !== comment.documentId) {
      throw new Error('The document changed; open it again to ask')
    }
    const page = comment.anchor.page
    const around =
      doc.kind === 'pdf'
        ? await pdfPageText(doc.pdf, page)
        : markdownBlocksText(doc.markdown, page)
    const answer = await askFlow.request({
      question: comment.body,
      quote,
      place: placeLabel(comment.anchor).toLowerCase(),
      surrounding: surroundingText(around, quote),
      earlier: (comment.answers ?? []).map(({ question, text }) => ({
        question,
        text,
      })),
    })
    if (!answer) return
    if (docIdRef.current !== comment.documentId) {
      throw new Error('The document changed; the answer was not kept')
    }
    await storeRef.current.addAnswer(comment.id, answer)
  }

  async function deleteAnswer(comment: Comment, answer: Answer) {
    await store.removeAnswer(comment.id, answer.id)
  }

  // The landing lists the documents with notes in this browser.
  useEffect(() => {
    if (doc) return
    let cancelled = false
    void (async () => {
      try {
        const opened = await openAnnotationStore()
        try {
          const [documents, stored] = await Promise.all([
            opened.listDocuments(),
            storedDocuments.ids(),
          ])
          if (!cancelled) {
            setRecent(
              documents.map((d) => ({ ...d, stored: stored.has(d.id) })),
            )
          }
        } finally {
          opened.close()
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(`Could not list the documents with notes: ${messageOf(err)}`)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, recentVersion, storedDocuments])

  async function openFile(file: File, options: OpenOptions = {}) {
    const { expected = null, resumePage = null } = options
    if (loading) return
    setError(null)
    const markdown = isMarkdownFile(file)
    if (!markdown && !isPdfFile(file)) {
      setError(`"${file.name}" is neither a PDF nor a Markdown file.`)
      return
    }
    setLoading(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let opened: OpenDocument
      if (markdown) {
        const [id, source] = await Promise.all([
          computeDocumentId(bytes),
          file.text(),
        ])
        opened = {
          kind: 'markdown',
          id,
          name: file.name,
          size: bytes.length,
          markdown: parseMarkdown(source),
        }
      } else {
        const [id, pdf] = await Promise.all([
          computeDocumentId(bytes),
          loadDocument(bytes),
        ])
        opened = {
          kind: 'pdf',
          id,
          name: file.name,
          size: bytes.length,
          bytes,
          pdf,
        }
      }
      release(doc)
      // A consent dialog for the old document must not outlive it.
      transcription.finish(null)
      cleanUpFlow.finish(null)
      askFlow.finish(null)
      setArrivals({})
      openIdRef.current = opened.id
      setDoc(opened)
      setSelectedId(null)
      if (expected && expected.id !== opened.id) {
        setError(
          `"${file.name}" is not the file those notes are for: its content differs from ${expected.name ? `"${expected.name}"` : 'that document'} (SHA-256 ${expected.id.slice(0, 12)}…). Notes for this file, if any, are shown instead.`,
        )
      }
      setResumable(null)
      if (resumePage !== null && opened.kind === 'pdf') {
        scrollToPageWhenLaidOut(resumePage)
      }
      keepDocument(
        opened,
        bytes,
        file.type || (markdown ? 'text/markdown' : 'application/pdf'),
        opened.kind === 'pdf' ? (resumePage ?? 1) : null,
      )
    } catch (err: unknown) {
      setError(
        `Could not open "${file.name}": ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setLoading(false)
    }
  }

  /** Downloads the PDF or Markdown file at `url` into the browser, then opens it. */
  async function openUrl(url: URL) {
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      const file = await fetchDocument(url, (input, init) => fetch(input, init))
      setLoading(false)
      await openFile(file)
    } catch (err: unknown) {
      setError(`Could not open ${url.href}: ${messageOf(err)}`)
      setLoading(false)
    }
  }

  /** Reopens a recent document from stored bytes, or asks for its file. */
  function resume(entry: RecentDocument) {
    setError(null)
    const expected = { id: entry.id, name: entry.name }
    expectedRef.current = expected
    if (!entry.stored) {
      // Synchronously, inside the tap: browsers open a file dialog only then.
      documentPickerRef.current?.click()
      return
    }
    void storedDocuments.get(entry.id).then(
      (file) => {
        if (!file) {
          setError(
            `The stored copy of ${entry.name ?? 'that document'} is gone; choose the file instead.`,
          )
          return
        }
        return openFile(file, { expected })
      },
      (err: unknown) =>
        setError(`Could not reopen the stored copy: ${messageOf(err)}`),
    )
  }

  /** Reads a notes export and shows what importing it would do. */
  async function startImport(file: File) {
    setError(null)
    try {
      if (file.size > MAX_NOTES_FILE_BYTES) {
        throw new Error(
          `it is ${file.size} bytes, more than any notes file (${MAX_NOTES_FILE_BYTES} bytes at most)`,
        )
      }
      const notes = parseNotesFile(await file.text())
      checkAgainstOpenDocument(notes)
      const existing = await storedAnnotationsOf(notes.document.id)
      setPendingImport({
        fileName: file.name,
        notes,
        plan: planMerge(existing, notes.annotations),
      })
    } catch (err: unknown) {
      setError(`Could not import "${file.name}": ${messageOf(err)}`)
    }
  }

  /**
   * The file is checked against the shape it declares; when its document is
   * the open one, against the real page or block count and kind too, so a
   * hand-edited file cannot store anchors the document does not have.
   */
  function checkAgainstOpenDocument(notes: NotesFile) {
    if (!doc || doc.id !== notes.document.id) return
    try {
      validatedAndSorted(exportInfo(doc), notes.annotations)
    } catch (err: unknown) {
      throw new Error(
        `the notes do not fit the open "${doc.name}": ${messageOf(err)}`,
      )
    }
  }

  async function storedAnnotationsOf(documentId: string) {
    if (docIdRef.current === documentId) {
      if (!storeRef.current.ready) {
        throw new Error('the open document’s notes are still loading')
      }
      return storeRef.current.annotations
    }
    const opened = await openAnnotationStore()
    try {
      return await opened.list(documentId)
    } finally {
      opened.close()
    }
  }

  /**
   * Merges the file into the store. The comparison is made again at write
   * time, since the stored notes may have changed while the dialog was open;
   * a new conflict nobody chose a side for fails the import loudly.
   */
  async function applyImport(
    notes: NotesFile,
    resolutions: Resolutions,
  ): Promise<ImportSummary> {
    const id = notes.document.id
    const open = docIdRef.current === id
    if (open) checkAgainstOpenDocument(notes)
    const label = open && docLabel ? docLabel : labelOf(notes.document)
    const write = async (target: AnnotationStore) => {
      const plan = planMerge(await target.list(id), notes.annotations)
      return applyMerge(target, plan, resolutions, label)
    }
    if (open) return storeRef.current.writeAndReload(write)
    const opened = await openAnnotationStore()
    try {
      return await write(opened)
    } finally {
      opened.close()
      setRecentVersion((v) => v + 1)
    }
  }

  function closeDocument() {
    openIdRef.current = null
    // Reopening the same document looks at its draft again.
    setToolSetFor(null)
    // A deliberate close is not a crash: nothing to resume next time.
    recovery.store?.clearSession().catch((err: unknown) => {
      setError(`Could not clear the session: ${messageOf(err)}`)
    })
    release(doc)
    transcription.finish(null)
    cleanUpFlow.finish(null)
    askFlow.finish(null)
    setArrivals({})
    setDoc(null)
    setSelectedId(null)
    setTool('select')
  }

  function createHighlight(anchor: Anchor, color: HighlightColor) {
    store.addHighlight(anchor, color).then(
      (a) => setSelectedId(a.id),
      (err: unknown) => setError(messageOf(err)),
    )
  }

  async function createNote({
    pendingTranscript,
    ask,
    ...request
  }: NewNoteRequest) {
    const note = await store.addNote(request)
    setSelectedId(note.id)
    if (pendingTranscript) receiveTranscript(note, pendingTranscript)
    // "Save and ask…": the comment is saved; the question follows. A
    // failure to ask shows in the error bar and leaves the comment as saved.
    if (ask && note.kind === 'comment') {
      askStored(note).catch((err: unknown) => setError(messageOf(err)))
    }
  }

  /** The transcript reaches the saved note, or its error shows in the panel. */
  function receiveTranscript(
    note: Note,
    pendingTranscript: Promise<Transcript | null>,
  ) {
    void deliverTranscript(note, pendingTranscript, {
      currentDocumentId: () => docIdRef.current,
      setTranscript: (id, transcript) =>
        storeRef.current.setTranscript(id, transcript),
      onArrival: (id, arrival) =>
        setArrivals((current) => {
          const next = { ...current }
          if (arrival) next[id] = arrival
          else delete next[id]
          return next
        }),
    })
  }

  async function updateBody(note: Note, body: string) {
    await store.updateBody(note.id, body)
  }

  async function updateVisibility(a: Annotation, visibility: Visibility) {
    await store.updateVisibility(a.id, visibility)
  }

  async function updateColor(h: Highlight, color: HighlightColor) {
    await store.updateColor(h.id, color)
  }

  function deleteAnnotation(a: Annotation) {
    store.remove(a.id).then(
      () => setSelectedId((id) => (id === a.id ? null : id)),
      (err: unknown) => setError(messageOf(err)),
    )
  }

  function selectAnnotation(a: Annotation) {
    setSelectedId(a.id)
    viewerRef.current?.scrollToAnnotation(a)
    markdownViewerRef.current?.scrollToAnnotation(a)
  }

  async function exportAs(format: ExportFormat) {
    if (!doc) return
    const name = baseName(doc.name)
    const info = exportInfo(doc)
    try {
      switch (format) {
        case 'pdf': {
          if (doc.kind !== 'pdf') {
            throw new Error('Only a PDF can be exported as an annotated PDF')
          }
          const bytes = await exportAnnotatedPdf(doc.bytes, store.annotations)
          downloadFile(
            bytes as BlobPart,
            `${name}-voxnote.pdf`,
            'application/pdf',
          )
          return
        }
        case 'markdown':
          downloadFile(
            exportMarkdown(info, store.annotations),
            `${name}.voxnote.md`,
            'text/markdown;charset=utf-8',
          )
          return
        case 'json':
          downloadFile(
            exportJson(info, store.annotations),
            `${name}.voxnote.json`,
            'application/json',
          )
          return
      }
    } catch (err: unknown) {
      setError(`Export failed: ${messageOf(err)}`)
    }
  }

  // Rendered in both views: Recent documents and the import summary ask for
  // a document, and the header's Import notes… asks for a notes file.
  const pickers = (
    <>
      <input
        ref={documentPickerRef}
        type="file"
        accept="application/pdf,.pdf,text/markdown,.md,.markdown"
        hidden
        aria-label="Document to continue"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void openFile(file, { expected: expectedRef.current })
        }}
      />
      <input
        ref={notesPickerRef}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Notes file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void startImport(file)
        }}
      />
      {pendingImport && (
        <ImportNotesDialog
          key={pendingImport.notes.exportedAt + pendingImport.fileName}
          fileName={pendingImport.fileName}
          notes={pendingImport.notes}
          plan={pendingImport.plan}
          documentOpen={doc?.id === pendingImport.notes.document.id}
          onApply={(resolutions) =>
            applyImport(pendingImport.notes, resolutions)
          }
          onOpenDocument={() => {
            const { id, name } = pendingImport.notes.document
            expectedRef.current = { id, name }
            setPendingImport(null)
            documentPickerRef.current?.click()
          }}
          onClose={() => setPendingImport(null)}
        />
      )}
    </>
  )

  if (!doc) {
    return (
      <main className="app">
        <OpenPdf
          onFile={(file) => void openFile(file)}
          interrupted={resumable}
          onResumeInterrupted={(target) => void resumeInterrupted(target)}
          onForgetInterrupted={(target) => void forget(target)}
          storage={storage.status}
          onUrl={(url) => void openUrl(url)}
          onImportNotes={(file) => void startImport(file)}
          recentDocuments={recent}
          onResume={resume}
          onDraftXml={(file) => {
            setError(null)
            setDraftXml(file)
          }}
          error={error ?? recovery.error}
        />
        {loading && <p className="app-status">Opening…</p>}
        {draftXml && (
          <RenderDraftDialog
            key={draftXml.name + draftXml.lastModified}
            xml={draftXml}
            onDone={(pdf) => {
              setDraftXml(null)
              void openFile(pdf)
            }}
            onCancel={() => setDraftXml(null)}
          />
        )}
        {pickers}
      </main>
    )
  }

  return (
    <main className="app">
      <header className="app-bar">
        <button type="button" onClick={closeDocument}>
          ← Close
        </button>
        <span className="app-title" title={doc.id}>
          {doc.name}
        </span>
        {doc.kind === 'pdf' && (
          <div
            className="app-tools"
            role="radiogroup"
            aria-label="Selection tool"
          >
            <button
              type="button"
              role="radio"
              aria-checked={tool === 'select'}
              onClick={() => setTool('select')}
            >
              Text
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={tool === 'region'}
              onClick={() => setTool('region')}
            >
              Region
            </button>
          </div>
        )}
        <button
          type="button"
          aria-pressed={listOpen}
          onClick={() => setListOpen((v) => !v)}
        >
          Annotations ({store.annotations.length})
        </button>
        <ExportMenu
          disabled={!store.ready}
          pdfDisabled={
            doc.kind === 'pdf' ? store.annotations.length === 0 : 'hidden'
          }
          onExport={(format) => void exportAs(format)}
          onImport={() => notesPickerRef.current?.click()}
        />
        <AiKeysButton
          pressed={settingsOpen}
          onClick={() => setSettingsOpen(true)}
        />
        <GitHubLink className="app-bar-github" />
      </header>
      {(error ||
        store.error ||
        autoConsents.error ||
        highlightColor.error ||
        recovery.error ||
        drafts.error) && (
        <p role="alert" className="app-error">
          {error ??
            store.error ??
            autoConsents.error ??
            highlightColor.error ??
            recovery.error ??
            drafts.error}
        </p>
      )}
      <div className="app-body">
        <ErrorBoundary label="The viewer">
          {!drafts.ready ? (
            <p className="app-status">Opening…</p>
          ) : doc.kind === 'pdf' ? (
            <PdfViewer
              // A new document starts with no pending anchor or open composer.
              key={doc.id}
              ref={viewerRef}
              document={doc.pdf}
              tool={tool}
              annotations={store.annotations}
              selectedId={selectedId}
              highlightColor={highlightColor.color}
              onHighlightColorChange={highlightColor.setColor}
              onCreateHighlight={createHighlight}
              onCreateNote={createNote}
              transcribe={transcription.request}
              cleanUp={cleanUpFlow.request}
              canAsk
              autoTranscribe={transcription.auto}
              drafts={drafts}
            />
          ) : (
            <MarkdownViewer
              key={doc.id}
              ref={markdownViewerRef}
              document={doc.markdown}
              annotations={store.annotations}
              selectedId={selectedId}
              highlightColor={highlightColor.color}
              onHighlightColorChange={highlightColor.setColor}
              onCreateHighlight={createHighlight}
              onCreateNote={createNote}
              transcribe={transcription.request}
              cleanUp={cleanUpFlow.request}
              canAsk
              autoTranscribe={transcription.auto}
              drafts={drafts}
            />
          )}
        </ErrorBoundary>
        {listOpen && (
          <AnnotationList
            annotations={store.annotations}
            selectedId={selectedId}
            onSelect={selectAnnotation}
            onDelete={deleteAnnotation}
            onUpdateBody={updateBody}
            onUpdateVisibility={updateVisibility}
            onUpdateColor={updateColor}
            onLoadAudio={(c) => store.getAudio(c.id)}
            onTranscribe={transcribeStored}
            onCleanUp={cleanUpStored}
            onAsk={askStored}
            onDeleteAnswer={deleteAnswer}
            arrivals={arrivals}
          />
        )}
      </div>
      {settingsOpen && (
        <ProviderSettings
          providers={providers}
          autoTranscribe={{
            documents: Object.keys(autoConsents.consents).length,
            revokeAll: () => autoConsents.revoke(null),
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {transcription.pending && !transcription.pending.automatic && (
        <TranscribeDialog
          key={transcription.pending.id}
          input={transcription.pending.input}
          provider={transcription.pending.provider}
          language={providers.settings.language}
          offerStanding={transcription.pending.offerStanding}
          onConfirm={transcription.confirm}
          onDone={(t) =>
            transcription.finish(t, transcription.pending ?? undefined)
          }
          onCancel={() =>
            transcription.finish(null, transcription.pending ?? undefined)
          }
        />
      )}
      {cleanUpFlow.pending && (
        <CleanUpDialog
          key={cleanUpFlow.pending.id}
          input={cleanUpFlow.pending.input}
          provider={cleanUpFlow.pending.provider}
          model={cleanUpFlow.pending.model}
          language={providers.settings.language}
          onConfirm={cleanUpFlow.confirm}
          onAccept={(p) =>
            cleanUpFlow.finish(p, cleanUpFlow.pending ?? undefined)
          }
          onCancel={() =>
            cleanUpFlow.finish(null, cleanUpFlow.pending ?? undefined)
          }
        />
      )}
      {askFlow.pending && (
        <AskDialog
          key={askFlow.pending.id}
          input={askFlow.pending.input}
          provider={askFlow.pending.provider}
          model={askFlow.pending.model}
          language={providers.settings.language}
          onConfirm={askFlow.confirm}
          onKeep={(a) => askFlow.finish(a, askFlow.pending ?? undefined)}
          onCancel={() => askFlow.finish(null, askFlow.pending ?? undefined)}
        />
      )}
      {pickers}
    </main>
  )
}

/** The kept document of the last unclean exit, if there is one. */
async function findResumable(store: RecoveryStore): Promise<Resumable | null> {
  const session = await store.getSession()
  if (!session) return null
  const stored = await store.getDocument(session.documentId)
  if (!stored) {
    throw new Error(
      'the document that was open is no longer kept on this device; open its file again',
    )
  }
  return {
    documentId: stored.id,
    name: stored.name,
    page: session.page,
    openedAt: session.updatedAt,
  }
}

/**
 * Brings a page into view once the viewer has laid it out: pages render
 * only near the screen, but the target page and every page above it take
 * real height first (`data-sized`), so this waits for those heights and not
 * for any drawing.
 */
function scrollToPageWhenLaidOut(page: number, framesLeft = 120) {
  const element = document.querySelector(`[data-page-number="${page}"]`)
  const pending = [
    ...document.querySelectorAll<HTMLElement>(
      '[data-page-number]:not([data-sized])',
    ),
  ].some((p) => Number(p.dataset.pageNumber) <= page)
  if (element && (!pending || framesLeft === 0)) {
    element.scrollIntoView({ block: 'start' })
    return
  }
  if (framesLeft > 0) {
    requestAnimationFrame(() => scrollToPageWhenLaidOut(page, framesLeft - 1))
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export default App
