import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SelectionToolbar } from './SelectionToolbar'

const placement = { left: 0, top: 0, bottom: 0 }

describe('SelectionToolbar', () => {
  it('offers Suggest only when the anchor can be replaced', () => {
    const onSuggest = vi.fn()
    const { rerender } = render(
      <SelectionToolbar
        placement={placement}
        color="yellow"
        onColorChange={() => {}}
        onHighlight={() => {}}
        onComment={() => {}}
        onVoice={() => {}}
        onSuggest={onSuggest}
      />,
    )
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Highlight',
      'Comment',
      '🎤 Voice',
      'Suggest',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }))
    expect(onSuggest).toHaveBeenCalled()

    rerender(
      <SelectionToolbar
        placement={placement}
        color="yellow"
        onColorChange={() => {}}
        onHighlight={() => {}}
        onComment={() => {}}
        onVoice={() => {}}
        onSuggest={null}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Suggest' })).toBeNull()
  })

  it('offers the palette as dots before the Highlight action', () => {
    const onColorChange = vi.fn()
    render(
      <SelectionToolbar
        placement={placement}
        color="blue"
        onColorChange={onColorChange}
        onHighlight={() => {}}
        onComment={() => {}}
        onVoice={() => {}}
        onSuggest={null}
      />,
    )
    const group = screen.getByRole('radiogroup', { name: 'Highlight color' })
    const toolbar = screen.getByRole('toolbar')
    expect(toolbar.contains(group)).toBe(true)
    const highlight = screen.getByRole('button', { name: 'Highlight' })
    expect(
      group.compareDocumentPosition(highlight) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Blue' })).toHaveProperty(
      'ariaChecked',
      'true',
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Orange' }))
    expect(onColorChange).toHaveBeenCalledWith('orange')
  })
})
