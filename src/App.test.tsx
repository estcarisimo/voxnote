import 'fake-indexeddb/auto'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { createComment, createHighlight } from './core/annotations'
import { exportJson } from './core/exportNotes'

describe('App', () => {
  it('shows the open-PDF landing view', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'VoxNote' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open a document' })).toBeTruthy()
  })

  it('imports a notes file on the landing and lists its document to reopen', async () => {
    const id = 'c'.repeat(64)
    const anchor = {
      type: 'region',
      page: 1,
      rect: { x: 0, y: 0, width: 9, height: 9 },
    } as const
    const json = exportJson(
      { kind: 'pdf', name: 'paper.pdf', id, size: 1234, pageCount: 2 },
      [
        createHighlight({ documentId: id, anchor }),
        createComment({ documentId: id, anchor, body: 'Why?' }),
      ],
      new Date('2026-11-07T12:00:00Z'),
      '0.0.0',
    )
    render(<App />)
    fireEvent.change(screen.getByLabelText('Notes file to import'), {
      target: {
        files: [
          new File([json], 'paper.voxnote.json', { type: 'application/json' }),
        ],
      },
    })
    const dialog = await screen.findByRole('dialog', {
      name: 'Import notes for paper.pdf?',
    })
    expect(within(dialog).getByText(/That document is not open/)).toBeTruthy()
    expect(
      within(dialog).getByRole('list', { name: 'What the file holds' })
        .textContent,
    ).toContain('New: 2')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }))

    const summary = await screen.findByRole('dialog', {
      name: 'Notes imported',
    })
    expect(
      within(summary).getByRole('list', { name: 'Import summary' }).textContent,
    ).toContain('Added: 2')
    expect(
      within(summary).getByRole('button', { name: 'Open paper.pdf…' }),
    ).toBeTruthy()
    fireEvent.click(within(summary).getByRole('button', { name: 'Close' }))

    const recent = await screen.findByRole('button', { name: /paper\.pdf/ })
    expect(recent.textContent).toContain('2 annotations')
  })

  it('refuses an invalid notes file loudly', async () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Notes file to import'), {
      target: { files: [new File(['{"oops"'], 'broken.json')] },
    })
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Could not import "broken.json": This is not a VoxNote notes file/,
    )
  })
})
