import './ExportMenu.css'

export type ExportFormat = 'pdf' | 'markdown' | 'json'

interface Props {
  /** True until the annotation store has loaded; every export waits for it. */
  disabled: boolean
  /**
   * The annotated PDF needs at least one annotation to be worth a copy.
   * `'hidden'` for a document that is not a PDF: there is no copy to write.
   */
  pdfDisabled: boolean | 'hidden'
  onExport: (format: ExportFormat) => void
  /** Asks for a notes export (.voxnote.json) to merge in. */
  onImport: () => void
}

/**
 * Header group of export buttons, each of which only downloads a local file,
 * and the import of a notes export, which only reads one.
 */
export function ExportMenu({
  disabled,
  pdfDisabled,
  onExport,
  onImport,
}: Props) {
  return (
    <div
      className="app-tools export-menu"
      role="group"
      aria-label="Export and import"
    >
      {pdfDisabled !== 'hidden' && (
        <button
          type="button"
          onClick={() => onExport('pdf')}
          disabled={disabled || pdfDisabled}
          title="Download a copy of the PDF with the annotations"
        >
          Export PDF
        </button>
      )}
      <button
        type="button"
        onClick={() => onExport('markdown')}
        disabled={disabled}
        title="Download a Markdown report of the annotations"
      >
        Markdown
      </button>
      <button
        type="button"
        onClick={() => onExport('json')}
        disabled={disabled}
        title="Download the annotations as JSON"
      >
        JSON
      </button>
      <button
        type="button"
        onClick={onImport}
        disabled={disabled}
        title="Merge notes from a .voxnote.json export into this browser"
      >
        Import notes…
      </button>
    </div>
  )
}
