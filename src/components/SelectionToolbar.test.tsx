import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  describe('keeping the selection', () => {
    afterEach(() => {
      window.getSelection()?.removeAllRanges()
      document.body.replaceChildren()
    })

    /** Selects the text of a paragraph appended to the page. */
    function selectSomeText(): Range {
      const paragraph = document.createElement('p')
      paragraph.textContent = 'A passage the reviewer selected'
      document.body.append(paragraph)
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      const selection = window.getSelection()
      if (!selection) throw new Error('no selection')
      selection.removeAllRanges()
      selection.addRange(range)
      return range
    }

    function renderToolbar(onColorChange = vi.fn(), onHighlight = vi.fn()) {
      render(
        <SelectionToolbar
          placement={placement}
          color="yellow"
          onColorChange={onColorChange}
          onHighlight={onHighlight}
          onComment={() => {}}
          onVoice={() => {}}
          onSuggest={null}
        />,
      )
    }

    it('puts a selection that the tap collapsed back after a color pick', () => {
      const onColorChange = vi.fn()
      renderToolbar(onColorChange)
      selectSomeText()
      const dot = screen.getByRole('radio', { name: 'Pink' })
      fireEvent.pointerDown(dot)
      // On a touch device the tap clears the selection between press and click.
      window.getSelection()?.collapseToStart()
      expect(window.getSelection()?.isCollapsed).toBe(true)
      fireEvent.pointerUp(dot)
      fireEvent.click(dot)
      expect(onColorChange).toHaveBeenCalledWith('pink')
      expect(window.getSelection()?.toString()).toBe(
        'A passage the reviewer selected',
      )
    })

    it('hands an action the selection it was offered for', () => {
      const seen: string[] = []
      renderToolbar(
        vi.fn(),
        vi.fn(() => {
          seen.push(window.getSelection()?.toString() ?? '')
        }),
      )
      selectSomeText()
      const highlight = screen.getByRole('button', { name: 'Highlight' })
      fireEvent.pointerDown(highlight)
      window.getSelection()?.removeAllRanges()
      fireEvent.click(highlight)
      expect(seen).toEqual(['A passage the reviewer selected'])
    })

    it('leaves a selection that survived the tap alone', () => {
      renderToolbar()
      const range = selectSomeText()
      const dot = screen.getByRole('radio', { name: 'Pink' })
      fireEvent.pointerDown(dot)
      fireEvent.pointerUp(dot)
      fireEvent.click(dot)
      const selection = window.getSelection()
      expect(selection?.rangeCount).toBe(1)
      // The very same range object: nothing was removed and re-added.
      expect(selection?.getRangeAt(0)).toBe(range)
    })

    it('does not resurrect a selection collapsed before the press', () => {
      renderToolbar()
      selectSomeText()
      window.getSelection()?.removeAllRanges()
      const dot = screen.getByRole('radio', { name: 'Pink' })
      fireEvent.pointerDown(dot)
      fireEvent.pointerUp(dot)
      fireEvent.click(dot)
      expect(window.getSelection()?.rangeCount).toBe(0)
    })
  })

  it('offers Ask only when given a handler', () => {
    const onAsk = vi.fn()
    render(
      <SelectionToolbar
        placement={placement}
        color="yellow"
        onColorChange={() => {}}
        onHighlight={() => {}}
        onComment={() => {}}
        onVoice={() => {}}
        onSuggest={null}
        onAsk={onAsk}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '❓ Ask' }))
    expect(onAsk).toHaveBeenCalled()
  })
})
