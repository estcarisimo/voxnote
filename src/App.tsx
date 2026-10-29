import { useCallback, useRef, useState } from 'react'
import { AnnotationList } from './components/AnnotationList'
import { OpenPdf } from './components/OpenPdf'
import {
  PdfViewer,
  type NewCommentRequest,
  type PdfViewerHandle,
} from './components/PdfViewer'
import type { Tool } from './components/PdfPage'
import { ProviderSettings } from './components/ProviderSettings'
import {
  TranscribeDialog,
  type TranscribeFn,
  type TranscriptionInput,
} from './components/TranscribeDialog'
import type {
  Anchor,
  Annotation,
  Comment,
  Transcript,
} from './core/annotations'
import { exportAnnotatedPdf } from './core/exportPdf'
import {
  computeDocumentId,
  destroyDocument,
  isPdfFile,
  loadDocument,
  type PDFDocumentProxy,
} from './core/pdf'
import { useAnnotations } from './hooks/useAnnotations'
import { useProviders } from './hooks/useProviders'
import { createProvider, PROVIDER_LABELS } from './providers/registry'
import { transcribe, type SpeechToTextProvider } from './providers/stt'
import './App.css'

/** An upload waiting for the user's consent in the dialog. */
interface PendingUpload {
  input: TranscriptionInput
  provider: SpeechToTextProvider
  resolve: (transcript: Transcript | null) => void
}

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
  const [upload, setUpload] = useState<PendingUpload | null>(null)
  const viewerRef = useRef<PdfViewerHandle>(null)
  const store = useAnnotations(doc?.id ?? null)
  const providers = useProviders()

  // Transcription is consent-gated: this only opens the dialog. The promise
  // settles when the user sends (with the transcript), cancels (null), or
  // the upload fails (rejects, shown where the user asked for it).
  const requestTranscription = useCallback<TranscribeFn>(
    (input) =>
      new Promise((resolve, reject) => {
        const { settings } = providers
        if (!providers.ready) {
          reject(new Error('Provider keys are not ready yet'))
          return
        }
        if (!providers.hasKey(settings.provider)) {
          reject(
            new Error(
              `Add your ${PROVIDER_LABELS[settings.provider]} API key under Providers first`,
            ),
          )
          return
        }
        let provider: SpeechToTextProvider
        try {
          provider = createProvider(settings)
        } catch (err: unknown) {
          reject(err instanceof Error ? err : new Error(String(err)))
          return
        }
        setUpload({ input, provider, resolve })
      }),
    [providers],
  )

  async function runUpload(
    request: Parameters<SpeechToTextProvider['transcribe']>[0],
  ) {
    if (!upload) throw new Error('No upload is pending')
    const apiKey = await providers.readKey(providers.settings.provider)
    if (!apiKey)
      throw new Error('The API key is missing; add it under Providers')
    return transcribe(upload.provider, request, { apiKey })
  }

  async function transcribeStored(comment: Comment) {
    if (!comment.voice) throw new Error('This comment has no recording')
    const audio = await store.getAudio(comment.id)
    if (!audio) throw new Error('The recording is missing from local storage')
    const transcript = await requestTranscription({
      audio,
      mimeType: comment.voice.mimeType,
      durationMs: comment.voice.durationMs,
      quote: comment.anchor.type === 'text' ? comment.anchor.quote : null,
    })
    if (transcript) await store.setTranscript(comment.id, transcript)
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

  async function createComment(request: NewCommentRequest) {
    const comment = await store.addComment(request)
    setSelectedId(comment.id)
  }

  async function updateBody(comment: Comment, body: string) {
    await store.updateBody(comment.id, body)
  }

  function deleteAnnotation(a: Annotation) {
    store.remove(a.id).then(
      () => setSelectedId((id) => (id === a.id ? null : id)),
      (err: unknown) => setError(messageOf(err)),
    )
  }

  function selectAnnotation(a: Annotation) {
    setSelectedId(a.id)
    viewerRef.current?.scrollToPage(a.anchor.page)
  }

  async function exportPdf() {
    if (!doc) return
    try {
      const bytes = await exportAnnotatedPdf(doc.bytes, store.annotations)
      downloadBytes(bytes, doc.name.replace(/\.pdf$/i, '') + '-voxnote.pdf')
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
        <button
          type="button"
          onClick={exportPdf}
          disabled={!store.ready || store.annotations.length === 0}
        >
          Export PDF
        </button>
        <button
          type="button"
          aria-pressed={settingsOpen}
          onClick={() => setSettingsOpen(true)}
        >
          Providers
        </button>
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
          onCreateComment={createComment}
          transcribe={requestTranscription}
        />
        {listOpen && (
          <AnnotationList
            annotations={store.annotations}
            selectedId={selectedId}
            onSelect={selectAnnotation}
            onDelete={deleteAnnotation}
            onUpdateBody={updateBody}
            onLoadAudio={(c) => store.getAudio(c.id)}
            onTranscribe={transcribeStored}
          />
        )}
      </div>
      {settingsOpen && (
        <ProviderSettings
          providers={providers}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {upload && (
        <TranscribeDialog
          input={upload.input}
          provider={upload.provider}
          language={providers.settings.language}
          onConfirm={runUpload}
          onDone={(transcript) => {
            upload.resolve(transcript)
            setUpload(null)
          }}
          onCancel={() => {
            upload.resolve(null)
            setUpload(null)
          }}
        />
      )}
    </main>
  )
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default App
