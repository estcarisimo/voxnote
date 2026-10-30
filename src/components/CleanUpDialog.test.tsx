import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CleanUpProposal } from '../core/cleanUp'
import {
  CLEAN_UP_INSTRUCTIONS,
  type CleanUpRequest,
  type TextModelProvider,
} from '../providers/llm'
import { CleanUpDialog } from './CleanUpDialog'

const provider: TextModelProvider = {
  id: 'fake',
  name: 'Fake LLM',
  endpointHost: 'llm.example',
  models: [{ id: 'm1', label: 'M1' }],
  describeUpload: (r, model) =>
    `Sends the transcript${r.quote ? ' and the quote' : ''}${r.language ? ` (${r.language})` : ''} to llm.example, model ${model}`,
  cleanUp: vi.fn(),
}

const input = {
  transcript: 'um the claim is uh weak',
  kind: 'comment' as const,
  quote: 'the quoted passage',
  currentBody: 'um the claim is uh weak',
}

const proposal: CleanUpProposal = {
  text: 'The claim is weak.',
  cleanUp: {
    provider: 'fake',
    model: 'm1',
    createdAt: '2026-10-29T10:00:00.000Z',
    promptVersion: 1,
  },
}

function renderDialog(
  overrides: Partial<Parameters<typeof CleanUpDialog>[0]> = {},
) {
  const props = {
    input,
    provider,
    model: 'm1',
    language: 'es',
    onConfirm: vi.fn(async (request: CleanUpRequest) => {
      void request
      return proposal
    }),
    onAccept: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  render(<CleanUpDialog {...props} />)
  return props
}

describe('CleanUpDialog', () => {
  it('sends nothing until Send, and states what, where, which model and the prompt', async () => {
    const props = renderDialog()
    expect(
      screen.getByRole('heading', {
        name: 'Polish this transcript with Fake LLM?',
      }),
    ).toBeTruthy()
    expect(
      screen.getByText('Sends the transcript (es) to llm.example, model m1'),
    ).toBeTruthy()
    const prompt = screen.getByText(/Prompt \(version 1\)/).closest('details')!
    expect(prompt.textContent).toContain(CLEAN_UP_INSTRUCTIONS)
    expect(prompt.textContent).toContain('<note>um the claim is uh weak</note>')
    expect(prompt.textContent).not.toContain('<passage>')
    expect(props.onConfirm).not.toHaveBeenCalled()

    // Opting into the quote changes the disclosure and the shown message.
    fireEvent.click(screen.getByRole('checkbox'))
    expect(
      screen.getByText(
        'Sends the transcript and the quote (es) to llm.example, model m1',
      ),
    ).toBeTruthy()
    expect(prompt.textContent).toContain(
      '<passage>the quoted passage</passage>',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake LLM' }))
    expect(props.onConfirm).toHaveBeenCalledWith({
      transcript: input.transcript,
      kind: 'comment',
      language: 'es',
      quote: 'the quoted passage',
    })
    await screen.findByRole('heading', { name: 'Review the polished text' })
    expect(props.onAccept).not.toHaveBeenCalled()
  })

  it('shows raw and proposed side by side; Accept hands the proposal back', async () => {
    const props = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake LLM' }))
    const raw = await screen.findByRole('region', { name: 'Raw transcript' })
    expect(raw.textContent).toContain('um the claim is uh weak')
    const proposed = screen.getByRole('region', { name: 'Proposed text' })
    expect(proposed.textContent).toContain('Proposed by fake/m1')
    expect(proposed.textContent).toContain('The claim is weak.')
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(props.onAccept).toHaveBeenCalledWith(proposal)
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  it('Discard changes nothing', async () => {
    const props = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake LLM' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(props.onCancel).toHaveBeenCalled()
    expect(props.onAccept).not.toHaveBeenCalled()
  })

  it('warns when Accept would replace text the user already edited', async () => {
    renderDialog({ input: { ...input, currentBody: 'My own words.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake LLM' }))
    const note = await screen.findByRole('note')
    expect(note.textContent).toContain('Accepting replaces the current text')
    expect(note.textContent).toContain('My own words.')
  })

  it('shows errors in place and lets the user retry or cancel', async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'The model returned the transcript unchanged; nothing to clean up',
        ),
      )
      .mockResolvedValueOnce(proposal)
    const props = renderDialog({ onConfirm })
    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake LLM' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/unchanged/)
    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake LLM' }))
    await screen.findByRole('heading', { name: 'Review the polished text' })
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(props.onAccept).not.toHaveBeenCalled()
  })

  it('Cancel while sending calls onCancel and swallows the abort', async () => {
    let rejectSend!: (err: Error) => void
    const onConfirm = vi.fn(
      () =>
        new Promise<CleanUpProposal>((_, reject) => {
          rejectSend = reject
        }),
    )
    const props = renderDialog({ onConfirm })
    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake LLM' }))
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByRole('button', { name: 'Polishing…' }),
    ).toHaveProperty('disabled', true)
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel request' }),
    )
    expect(props.onCancel).toHaveBeenCalled()
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    rejectSend(abort)
    await Promise.resolve()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
