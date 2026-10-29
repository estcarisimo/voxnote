import './ExportMenu.css'

export type ExportFormat = 'pdf' | 'markdown' | 'json'

interface Props {
  /** True until the annotation store has loaded; every export waits for it. */
  disabled: boolean
  /** The annotated PDF needs at least one annotation to be worth a copy. */
  pdfDisabled: boolean
  onExport: (format: ExportFormat) => void
}

/** Header group of export buttons. Each one only downloads a local file. */
export function ExportMenu({ disabled, pdfDisabled, onExport }: Props) {
  return (
    <div className="app-tools export-menu" role="group" aria-label="Export">
      <button
        type="button"
        onClick={() => onExport('pdf')}
        disabled={disabled || pdfDisabled}
        title="Download a copy of the PDF with the annotations"
      >
        Export PDF
      </button>
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
    </div>
  )
}
