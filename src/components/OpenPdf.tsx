import { useRef, useState, type DragEvent } from 'react'
import './OpenPdf.css'

interface OpenPdfProps {
  onFile: (file: File) => void
  error: string | null
}

/** Landing view: pick a PDF with the file dialog or drop one onto the page. */
export function OpenPdf({ onFile, error }: OpenPdfProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function accept(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return
    onFile(file)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files)
  }

  return (
    <div
      className={`open-pdf${dragging ? ' open-pdf--dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <h1>VoxNote</h1>
      <p className="open-pdf-tagline">Your voice, in the margins.</p>
      <button type="button" onClick={() => inputRef.current?.click()}>
        Open a PDF
      </button>
      <p className="open-pdf-hint">or drop one here</p>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => accept(e.target.files)}
      />
      {error && (
        <p role="alert" className="open-pdf-error">
          {error}
        </p>
      )}
    </div>
  )
}
