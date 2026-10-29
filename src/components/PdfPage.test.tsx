import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from '../core/pdf'
import { PdfPage, type Tool } from './PdfPage'

// The page never finishes rendering (jsdom has no canvas); the test fills
// the text layer itself, one 10 px row per span and 10 px per character.
const pendingDocument = {
  getPage: () => new Promise(() => {}),
} as unknown as PDFDocumentProxy

function renderPage(tool: Tool = 'select') {
  const onPenSelecting = vi.fn()
  const { container } = render(
    <PdfPage
      document={pendingDocument}
      pageNumber={1}
      width={600}
      tool={tool}
      annotations={[]}
      selectedId={null}
      pendingAnchor={null}
      onGeometry={() => {}}
      onCreateRegion={() => {}}
      onPenSelecting={onPenSelecting}
    />,
  )
  const layer = container.querySelector<HTMLDivElement>('.textLayer')!
  for (const text of ['alpha', 'beta']) {
    const span = document.createElement('span')
    span.textContent = text
    layer.appendChild(span)
  }
  return { layer, onPenSelecting }
}

function caretRangeFromPoint(x: number, y: number): Range | null {
  const span = document.querySelectorAll('.textLayer span')[Math.floor(y / 10)]
  if (!span?.firstChild) return null
  const text = span.firstChild
  const range = document.createRange()
  range.setStart(text, Math.min(Math.floor(x / 10), text.textContent!.length))
  return range
}

const pen = { pointerId: 7, pointerType: 'pen', button: 0 }
const selected = () => window.getSelection()!.toString()

beforeEach(() => {
  // jsdom lacks both the caret lookup and pointer capture.
  Object.assign(document, { caretRangeFromPoint })
  Object.assign(Element.prototype, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: () => true,
  })
})

afterEach(() => {
  Reflect.deleteProperty(document, 'caretRangeFromPoint')
  window.getSelection()?.removeAllRanges()
})

describe('PdfPage pen selection', () => {
  it('selects text as a pen drags and reports the gesture', () => {
    const { layer, onPenSelecting } = renderPage()
    const down = fireEvent.pointerDown(layer, {
      ...pen,
      clientX: 10,
      clientY: 0,
    })
    expect(down).toBe(false) // default prevented: no pan, no native selection
    expect(onPenSelecting).toHaveBeenLastCalledWith(true)

    fireEvent.pointerMove(layer, { ...pen, clientX: 40, clientY: 0 })
    expect(selected()).toBe('lph')
    fireEvent.pointerMove(layer, { ...pen, clientX: 20, clientY: 10 })
    expect(selected()).toBe('lphabe')

    fireEvent.pointerUp(layer, { ...pen, clientX: 20, clientY: 10 })
    expect(selected()).toBe('lphabe')
    expect(onPenSelecting).toHaveBeenLastCalledWith(false)
  })

  it('keeps the selection forward when dragging backwards', () => {
    const { layer } = renderPage()
    fireEvent.pointerDown(layer, { ...pen, clientX: 30, clientY: 10 })
    fireEvent.pointerMove(layer, { ...pen, clientX: 10, clientY: 0 })
    fireEvent.pointerUp(layer, { ...pen, clientX: 10, clientY: 0 })
    const range = window.getSelection()!.getRangeAt(0)
    expect(range.toString()).toBe('lphabet')
    expect(range.collapsed).toBe(false)
  })

  it('leaves no selection after a tap', () => {
    const { layer } = renderPage()
    const text = layer.querySelector('span')!.firstChild!
    window.getSelection()!.selectAllChildren(text.parentNode!)
    fireEvent.pointerDown(layer, { ...pen, clientX: 10, clientY: 0 })
    fireEvent.pointerMove(layer, { ...pen, clientX: 12, clientY: 1 })
    fireEvent.pointerUp(layer, { ...pen, clientX: 12, clientY: 1 })
    expect(window.getSelection()!.rangeCount).toBe(0)
  })

  it('clears the selection when the gesture is cancelled', () => {
    const { layer, onPenSelecting } = renderPage()
    fireEvent.pointerDown(layer, { ...pen, clientX: 10, clientY: 0 })
    fireEvent.pointerMove(layer, { ...pen, clientX: 40, clientY: 0 })
    fireEvent.pointerCancel(layer, pen)
    expect(window.getSelection()!.rangeCount).toBe(0)
    expect(onPenSelecting).toHaveBeenLastCalledWith(false)
  })

  it('leaves touch and mouse to the browser', () => {
    const { layer, onPenSelecting } = renderPage()
    for (const pointerType of ['touch', 'mouse']) {
      const down = fireEvent.pointerDown(layer, {
        pointerId: 1,
        pointerType,
        button: 0,
        clientX: 10,
        clientY: 0,
      })
      expect(down).toBe(true)
      fireEvent.pointerMove(layer, { pointerId: 1, pointerType, clientX: 40 })
      fireEvent.pointerUp(layer, { pointerId: 1, pointerType, clientX: 40 })
    }
    expect(onPenSelecting).not.toHaveBeenCalled()
    expect(window.getSelection()!.rangeCount).toBe(0)
  })

  it('ignores a pen under the Region tool', () => {
    const { layer, onPenSelecting } = renderPage('region')
    expect(
      fireEvent.pointerDown(layer, { ...pen, clientX: 10, clientY: 0 }),
    ).toBe(true)
    expect(onPenSelecting).not.toHaveBeenCalled()
  })

  it('blocks a stylus pan but lets a finger scroll', () => {
    const { layer } = renderPage()
    const touch = (type: string, touchType: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'changedTouches', {
        value: [{ touchType }],
      })
      return layer.dispatchEvent(event)
    }
    expect(touch('touchmove', 'stylus')).toBe(false)
    expect(touch('touchstart', 'stylus')).toBe(false)
    expect(touch('touchmove', 'direct')).toBe(true)
  })

  it('says so when the browser cannot look up carets', () => {
    Reflect.deleteProperty(document, 'caretRangeFromPoint')
    const { layer, onPenSelecting } = renderPage()
    fireEvent.pointerDown(layer, { ...pen, clientX: 10, clientY: 0 })
    expect(screen.getByRole('alert').textContent).toMatch(/caretRangeFromPoint/)
    expect(onPenSelecting).not.toHaveBeenCalled()
  })
})
