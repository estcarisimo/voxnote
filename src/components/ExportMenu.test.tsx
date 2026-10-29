import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExportMenu } from './ExportMenu'

describe('ExportMenu', () => {
  it('offers PDF, Markdown and JSON and reports which one was chosen', () => {
    const onExport = vi.fn()
    render(
      <ExportMenu disabled={false} pdfDisabled={false} onExport={onExport} />,
    )
    const group = screen.getByRole('group', { name: 'Export' })
    expect(
      Array.from(group.querySelectorAll('button')).map((b) => b.textContent),
    ).toEqual(['Export PDF', 'Markdown', 'JSON'])
    fireEvent.click(screen.getByRole('button', { name: 'Markdown' }))
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }))
    expect(onExport.mock.calls).toEqual([['markdown'], ['json'], ['pdf']])
  })

  it('disables everything while the store is not ready', () => {
    render(<ExportMenu disabled pdfDisabled={false} onExport={() => {}} />)
    for (const name of ['Export PDF', 'Markdown', 'JSON']) {
      expect(screen.getByRole('button', { name })).toHaveProperty(
        'disabled',
        true,
      )
    }
  })

  it('can disable only the PDF export', () => {
    render(<ExportMenu disabled={false} pdfDisabled onExport={() => {}} />)
    expect(screen.getByRole('button', { name: 'Export PDF' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByRole('button', { name: 'Markdown' })).toHaveProperty(
      'disabled',
      false,
    )
  })
})
