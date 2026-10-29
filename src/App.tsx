import { useState } from 'react'
import { OpenPdf } from './components/OpenPdf'
import { PdfViewer } from './components/PdfViewer'
import {
  computeDocumentId,
  destroyDocument,
  isPdfFile,
  loadDocument,
  type PDFDocumentProxy,
} from './core/pdf'
import './App.css'

interface OpenDocument {
  id: string
  name: string
  pdf: PDFDocumentProxy
}

function App() {
  const [doc, setDoc] = useState<OpenDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function openFile(file: File) {
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
      setDoc({ id, name: file.name, pdf })
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
        <span className="app-meta">{doc.pdf.numPages} pages</span>
      </header>
      <PdfViewer document={doc.pdf} />
    </main>
  )
}

export default App
