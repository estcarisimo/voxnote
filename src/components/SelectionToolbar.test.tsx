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
        onHighlight={() => {}}
        onComment={() => {}}
        onVoice={() => {}}
        onSuggest={null}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Suggest' })).toBeNull()
  })
})
