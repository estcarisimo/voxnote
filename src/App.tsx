import { useEffect, useRef, useState } from 'react'
import {
  AnnotationList,
  type TranscriptArrival,
} from './components/AnnotationList'
import { CleanUpDialog } from './components/CleanUpDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { deliverTranscript } from './components/deliverTranscript'
import { baseName, downloadFile } from './components/download'
import { ExportMenu, type ExportFormat } from './components/ExportMenu'
import { GitHubLink } from './components/GitHubLink'
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
  type Highlight,
  type Note,
  type Transcript,
  type Visibility,
} from './core/annotations'
import type { HighlightColor } from './core/palette'
import {
  exportJson,
  exportMarkdown,
  type ExportDocument,
} from './core/exportNotes'
import { exportAnnotatedPdf } from './core/exportPdf'
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
import type { RecoveryStore } from './core/recoveryStore'
import { fetchDocument } from './core/remotePdf'
import { useAnnotations } from './hooks/useAnnotations'
import { useAutoTranscribeConsent } from './hooks/useAutoTranscribeConsent'
import { useCleanUp } from './hooks/useCleanUp'
import { useDraft } from './hooks/useDraft'
import { useHighlightColor } from './hooks/useHighlightColor'
import { useProviders } from './hooks/useProviders'
import { useRecoveryStore } from './hooks/useRecoveryStore'
import { useSessionPage } from './hooks/useSessionPage'
import { useWindowErrors } from './hooks/useWindowErrors'
import { AiKeysButton } from './components/AiKeysButton'
import { useTranscription } from './hooks/useTranscription'
import './App.css'

/** The open document: its SHA-256 id, its file name and its parsed form. */
type OpenDocument =
  | {
      kind: 'pdf'
      id: string
      name: string
      bytes: Uint8Array
      pdf: PDFDocumentProxy
    }
  | { kind: 'markdown'; id: string; name: string; markdown: MarkdownDocument }

function exportInfo(doc: OpenDocument): ExportDocument {
  return doc.kind === 'pdf'
    ? { kind: 'pdf', name: doc.name, id: doc.id, pageCount: doc.pdf.numPages }
    : {
        kind: 'markdown',
        name: doc.name,
        id: doc.id,
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
  const drafts = useDraft(doc?.id ?? null, recovery)
  // The document that was open when the page last went away, if kept.
  const [resumable, setResumable] = useState<Resumable | null>(null)
  useWindowErrors(setError)
  useSessionPage(recovery.store, doc?.kind === 'pdf' ? doc.id : null, setError)
  const viewerRef = useRef<PdfViewerHandle>(null)
  const markdownViewerRef = useRef<MarkdownViewerHandle>(null)
  const store = useAnnotations(doc?.id ?? null)
  const highlightColor = useHighlightColor()
  const providers = useProviders()
  const autoConsents = useAutoTranscribeConsent(providers)
  const transcription = useTranscription(providers, {
    documentId: doc?.id ?? null,
    store: autoConsents,
  })
  const cleanUpFlow = useCleanUp(providers)
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
  useEffect(() => {
    const store = recovery.store
    if (!store || !landing) return
    let live = true
    findResumable(store).then(
      (found) => live && setResumable(found),
      (err: unknown) =>
        live && setError(`Could not read the last session: ${messageOf(err)}`),
    )
    return () => {
      live = false
    }
  }, [recovery.store, landing])

  // A restored draft on a region reopens with the Region tool, so its
  // composer is not dropped as belonging to another tool.
  const [toolSetFor, setToolSetFor] = useState<string | null>(null)
  if (doc && drafts.ready && toolSetFor !== doc.id) {
    setToolSetFor(doc.id)
    if (drafts.restored?.anchor.type === 'region') setTool('region')
  }

  /** Keeps the bytes and the session so a crash can be resumed. */
  async function keepDocument(
    opened: OpenDocument,
    bytes: Uint8Array,
    mimeType: string,
    page: number | null,
  ) {
    const store = recovery.store
    if (!store) return
    const blob = new Blob([bytes as BlobPart], { type: mimeType })
    try {
      await store.putDocument({
        id: opened.id,
        name: opened.name,
        mimeType,
        blob,
        size: blob.size,
        openedAt: new Date().toISOString(),
      })
    } catch (err: unknown) {
      let message = `"${opened.name}" is open, but a copy could not be kept on this device (${messageOf(err)}). If this tab crashes you will need to open the file again; your annotations are saved separately.`
      // Resume must not offer the previous document instead.
      try {
        await store.clearSession()
      } catch (clearErr: unknown) {
        message += ` The previous session could not be cleared either (${messageOf(clearErr)}), so Resume may offer the document opened before this one.`
      }
      setError(message)
      return
    }
    try {
      await store.putSession({
        documentId: opened.id,
        page,
        updatedAt: new Date().toISOString(),
      })
    } catch (err: unknown) {
      setError(`Could not record the open document: ${messageOf(err)}`)
    }
  }

  async function resume(target: Resumable) {
    const store = recovery.store
    if (!store || loading) return
    setError(null)
    try {
      const stored = await store.getDocument(target.documentId)
      if (!stored) throw new Error('it is no longer kept on this device')
      const file = new File([stored.blob], stored.name, {
        type: stored.mimeType,
      })
      await openFile(file, target.page)
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

  async function openFile(file: File, resumePage: number | null = null) {
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
          markdown: parseMarkdown(source),
        }
      } else {
        const [id, pdf] = await Promise.all([
          computeDocumentId(bytes),
          loadDocument(bytes),
        ])
        opened = { kind: 'pdf', id, name: file.name, bytes, pdf }
      }
      release(doc)
      // A consent dialog for the old document must not outlive it.
      transcription.finish(null)
      cleanUpFlow.finish(null)
      setArrivals({})
      setDoc(opened)
      setSelectedId(null)
      setResumable(null)
      if (resumePage !== null && opened.kind === 'pdf') {
        scrollToPageWhenLaidOut(resumePage)
      }
      void keepDocument(
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

  function closeDocument() {
    // A deliberate close is not a crash: nothing to resume next time.
    recovery.store?.clearSession().catch((err: unknown) => {
      setError(`Could not clear the session: ${messageOf(err)}`)
    })
    release(doc)
    transcription.finish(null)
    cleanUpFlow.finish(null)
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

  async function createNote({ pendingTranscript, ...request }: NewNoteRequest) {
    const note = await store.addNote(request)
    setSelectedId(note.id)
    if (pendingTranscript) receiveTranscript(note, pendingTranscript)
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

  if (!doc) {
    return (
      <main className="app">
        <OpenPdf
          onFile={(file) => void openFile(file)}
          resumable={resumable}
          onResume={(target) => void resume(target)}
          onForget={(target) => void forget(target)}
          onUrl={(url) => void openUrl(url)}
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
 * Brings a page into view once the viewer has laid it out: pages exist as
 * sized placeholders before they render, so this waits only for the mount.
 */
function scrollToPageWhenLaidOut(page: number, framesLeft = 120) {
  const element = document.querySelector(`[data-page-number="${page}"]`)
  if (element) {
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
