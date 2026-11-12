import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Answer } from '../core/annotations'
import type { AnswerLength, AskRequest } from '../core/ask'
import type { AskInput } from '../hooks/useAsk'
import type { TextModelProvider } from '../providers/llm'
import { AskDialog } from './AskDialog'

const provider: TextModelProvider = {
  id: 'fake',
  name: 'Fake LLM',
  endpointHost: 'llm.example',
  models: [{ id: 'm1', label: 'M1' }],
  describeDestination: (model) => `to llm.example, model ${model}`,
  generate: vi.fn(),
}

const input: AskInput = {
  question: 'What is decoherence?',
  quote: 'the qubit decoheres',
  place: 'page 2',
  surrounding: 'Before. the qubit decoheres. After.',
  earlier: [],
}

const answer: Answer = {
  id: 'a1',
  question: input.question,
  text: 'The loss of quantum superposition.',
  provider: 'fake',
  model: 'm1',
  promptVersion: 1,
  context: { surroundingChars: 0, earlierAnswers: 0 },
  createdAt: '2026-11-11T12:00:00.000Z',
}

function renderDialog(
  overrides: Partial<Parameters<typeof AskDialog>[0]> = {},
) {
  const props = {
    input,
    provider,
    model: 'm1',
    language: '',
    length: 'paragraph' as AnswerLength,
    onLengthChange: vi.fn(),
    onConfirm: vi.fn(async (request: AskRequest) => {
      void request
      return answer
    }),
    onKeep: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  render(<AskDialog {...props} />)
  return props
}

describe('AskDialog', () => {
  it('says what is sent and sends nothing until Send', async () => {
    const props = renderDialog()
    expect(
      screen.getByText(
        'Sends your question (20 characters), the quoted passage (19 characters), the answer length you chose (one paragraph) and the instructions shown under Prompt to llm.example, model m1. Nothing else: not the recording, not the rest of the document, not other comments.',
      ),
    ).toBeTruthy()
    expect(props.onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake LLM' }))
    expect(props.onConfirm).toHaveBeenCalledWith({
      question: input.question,
      quote: input.quote,
      length: 'paragraph',
    })
    expect(
      await screen.findByText('The loss of quantum superposition.'),
    ).toBeTruthy()
    expect(screen.getByText('Answer from fake/m1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(props.onKeep).toHaveBeenCalledWith({ answer, followUp: null })
  })

  it('sends the surrounding text only when ticked, and says so first', () => {
    const props = renderDialog({
      input: { ...input, earlier: [{ question: 'q0', text: 'a0' }] },
      language: 'es',
    })
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /Also send the text around the passage \(35 characters from page 2\)/,
      }),
    )
    expect(
      screen.getByText(/35 characters of the document around it \(page 2\)/),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake LLM' }))
    expect(props.onConfirm).toHaveBeenCalledWith({
      question: input.question,
      quote: input.quote,
      length: 'paragraph',
      language: 'es',
      surrounding: { text: input.surrounding, place: 'page 2' },
      earlier: [{ question: 'q0', text: 'a0' }],
    })
  })

  it('says when the surrounding text could not be found', () => {
    renderDialog({ input: { ...input, surrounding: null } })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(
      screen.getByText(/could not be found on page 2, so only the passage/),
    ).toBeTruthy()
  })

  it('shows a failed request and lets the user try again or cancel', async () => {
    const props = renderDialog({
      onConfirm: vi.fn(async () => {
        throw new Error('Fake LLM responded 401: bad key')
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake LLM' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Fake LLM responded 401: bad key',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onCancel).toHaveBeenCalled()
    expect(props.onKeep).not.toHaveBeenCalled()
  })

  it('lets the reader pick the answer length, which goes into the request', () => {
    const props = renderDialog({ length: 'thorough' })
    expect(screen.getByRole('radio', { name: 'Thorough' })).toHaveProperty(
      'checked',
      true,
    )
    expect(
      screen.getByText(/the answer length you chose \(thorough\)/),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'One line' }))
    expect(props.onLengthChange).toHaveBeenCalledWith('line')
    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake LLM' }))
    expect(props.onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ length: 'thorough' }),
    )
  })

  it('shows the earlier thread and keeps an answer with a typed follow-up', async () => {
    const props = renderDialog({
      input: {
        ...input,
        question: 'And how is it measured?',
        earlier: [{ question: input.question, text: 'Loss of coherence.' }],
      },
    })
    expect(screen.getByText('Ask Fake LLM a follow-up?')).toBeTruthy()
    expect(screen.getByText('Earlier in this thread (1 question)')).toBeTruthy()
    expect(screen.getByText('Loss of coherence.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Fake LLM' }))
    await screen.findByText('The loss of quantum superposition.')
    expect(screen.queryByRole('button', { name: 'Keep and ask…' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Keep' })).toBeTruthy()
    fireEvent.change(
      screen.getByRole('textbox', { name: /Follow-up question/ }),
      { target: { value: '  Why 3 µs?  ' } },
    )
    // With a follow-up typed, a plain Keep would drop it: it is not offered.
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Keep and ask…' }))
    expect(props.onKeep).toHaveBeenCalledWith({
      answer,
      followUp: 'Why 3 µs?',
    })
  })
})
