import { useEffect, useRef, useState } from 'react'
import { AnnotationList } from './components/AnnotationList'
import { CleanUpDialog } from './components/CleanUpDialog'
import { baseName, downloadFile } from './components/download'
import { ExportMenu, type ExportFormat } from './components/ExportMenu'
import { OpenPdf } from './components/OpenPdf'
import {
  PdfViewer,
  type NewNoteRequest,
  type PdfViewerHandle,
} from './components/PdfViewer'
import type { Tool } from './components/PdfPage'
import { ProviderSettings } from './components/ProviderSettings'
import { TranscribeDialog } from './components/TranscribeDialog'
import type { Anchor, Annotation, Note, Visibility } from './core/annotations'
import { exportJson, exportMarkdown } from './core/exportNotes'
import { exportAnnotatedPdf } from './core/exportPdf'
import {
  computeDocumentId,
  destroyDocument,
  isPdfFile,
  loadDocument,
  type PDFDocumentProxy,
} from './core/pdf'
import { useAnnotations } from './hooks/useAnnotations'
import { useCleanUp } from './hooks/useCleanUp'
import { useProviders } from './hooks/useProviders'
import { AiKeysButton } from './components/AiKeysButton'
import { useTranscription } from './hooks/useTranscription'
import './App.css'

interface OpenDocument {
  id: string
  name: string
  bytes: Uint8Array
  pdf: PDFDocumentProxy
}

function App() {
  const [doc, setDoc] = useState<OpenDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tool, setTool] = useState<Tool>('select')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const viewerRef = useRef<PdfViewerHandle>(null)
  const store = useAnnotations(doc?.id ?? null)
  const providers = useProviders()
  const transcription = useTranscription(providers)
  const cleanUpFlow = useCleanUp(providers)
  // The open document's id as of the last render, for checks after an await.
  const docIdRef = useRef<string | null>(null)
  useEffect(() => {
    docIdRef.current = doc?.id ?? null
  }, [doc])

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
      quote: comment.anchor.type === 'text' ? comment.anchor.quote : null,
    })
    if (transcript) await store.setTranscript(comment.id, transcript)
  }

  async function cleanUpStored(note: Note) {
    const transcript = note.voice?.transcript
    if (!transcript) throw new Error('This note has no raw transcript')
    const proposal = await cleanUpFlow.request({
      transcript: transcript.raw,
      kind: note.kind,
      quote: note.anchor.type === 'text' ? note.anchor.quote : null,
      currentBody: note.body,
    })
    if (!proposal) return
    if (docIdRef.current !== note.documentId) {
      throw new Error('The document changed; the clean-up was not applied')
    }
    await store.applyCleanUp(note.id, proposal)
  }

  async function openFile(file: File) {
    if (loading) return
    setError(null)
    if (!isPdfFile(file)) {
      setError(`"${file.name}" is not a PDF.`)
      return
    }
    setLoading(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const [id, pdf] = await Promise.all([
        computeDocumentId(bytes),
        loadDocument(bytes),
      ])
      if (doc) void destroyDocument(doc.pdf)
      // A consent dialog for the old document must not outlive it.
      transcription.finish(null)
      cleanUpFlow.finish(null)
      setDoc({ id, name: file.name, bytes, pdf })
      setSelectedId(null)
    } catch (err: unknown) {
      setError(
        `Could not open "${file.name}": ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setLoading(false)
    }
  }

  function closeDocument() {
    if (doc) void destroyDocument(doc.pdf)
    transcription.finish(null)
    cleanUpFlow.finish(null)
    setDoc(null)
    setSelectedId(null)
    setTool('select')
  }

  function createHighlight(anchor: Anchor) {
    store.addHighlight(anchor).then(
      (a) => setSelectedId(a.id),
      (err: unknown) => setError(messageOf(err)),
    )
  }

  async function createNote(request: NewNoteRequest) {
    const note = await store.addNote(request)
    setSelectedId(note.id)
  }

  async function updateBody(note: Note, body: string) {
    await store.updateBody(note.id, body)
  }

  async function updateVisibility(a: Annotation, visibility: Visibility) {
    await store.updateVisibility(a.id, visibility)
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
  }

  async function exportAs(format: ExportFormat) {
    if (!doc) return
    const name = baseName(doc.name)
    const info = { name: doc.name, id: doc.id, pageCount: doc.pdf.numPages }
    try {
      switch (format) {
        case 'pdf': {
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
        <OpenPdf onFile={openFile} error={error} />
        {loading && <p className="app-status">Opening…</p>}
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
        <button
          type="button"
          aria-pressed={listOpen}
          onClick={() => setListOpen((v) => !v)}
        >
          Annotations ({store.annotations.length})
        </button>
        <ExportMenu
          disabled={!store.ready}
          pdfDisabled={store.annotations.length === 0}
          onExport={(format) => void exportAs(format)}
        />
        <AiKeysButton
          pressed={settingsOpen}
          onClick={() => setSettingsOpen(true)}
        />
      </header>
      {(error || store.error) && (
        <p role="alert" className="app-error">
          {error ?? store.error}
        </p>
      )}
      <div className="app-body">
        <PdfViewer
          // A new document starts with no pending anchor or open composer.
          key={doc.id}
          ref={viewerRef}
          document={doc.pdf}
          tool={tool}
          annotations={store.annotations}
          selectedId={selectedId}
          onCreateHighlight={createHighlight}
          onCreateNote={createNote}
          transcribe={transcription.request}
          cleanUp={cleanUpFlow.request}
        />
        {listOpen && (
          <AnnotationList
            annotations={store.annotations}
            selectedId={selectedId}
            onSelect={selectAnnotation}
            onDelete={deleteAnnotation}
            onUpdateBody={updateBody}
            onUpdateVisibility={updateVisibility}
            onLoadAudio={(c) => store.getAudio(c.id)}
            onTranscribe={transcribeStored}
            onCleanUp={cleanUpStored}
          />
        )}
      </div>
      {settingsOpen && (
        <ProviderSettings
          providers={providers}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {transcription.pending && (
        <TranscribeDialog
          key={transcription.pending.id}
          input={transcription.pending.input}
          provider={transcription.pending.provider}
          language={providers.settings.language}
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
