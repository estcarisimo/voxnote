import { useEffect, useRef, useState } from 'react'
import {
  AnnotationList,
  type TranscriptArrival,
} from './components/AnnotationList'
import { CleanUpDialog } from './components/CleanUpDialog'
import { deliverTranscript } from './components/deliverTranscript'
import { baseName, downloadFile } from './components/download'
import { ExportMenu, type ExportFormat } from './components/ExportMenu'
import { GitHubLink } from './components/GitHubLink'
import {
  MarkdownViewer,
  type MarkdownViewerHandle,
} from './components/MarkdownViewer'
import { OpenPdf } from './components/OpenPdf'
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
import { fetchDocument } from './core/remotePdf'
import { useAnnotations } from './hooks/useAnnotations'
import { useAutoTranscribeConsent } from './hooks/useAutoTranscribeConsent'
import { useCleanUp } from './hooks/useCleanUp'
import { useHighlightColor } from './hooks/useHighlightColor'
import { useProviders } from './hooks/useProviders'
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

  async function openFile(file: File) {
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
          onFile={openFile}
          onUrl={(url) => void openUrl(url)}
          onDraftXml={(file) => {
            setError(null)
            setDraftXml(file)
          }}
          error={error}
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
      {(error || store.error || autoConsents.error || highlightColor.error) && (
        <p role="alert" className="app-error">
          {error ?? store.error ?? autoConsents.error ?? highlightColor.error}
        </p>
      )}
      <div className="app-body">
        {doc.kind === 'pdf' ? (
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
          />
        )}
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

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export default App
