import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HIGHLIGHT_COLORS } from '../core/palette'
import { ColorDots } from './ColorDots'

describe('ColorDots', () => {
  it('shows one named radio per palette color, the current one checked', () => {
    const onChange = vi.fn()
    render(
      <ColorDots value="blue" onChange={onChange} label="Highlight color" />,
    )
    const group = screen.getByRole('radiogroup', { name: 'Highlight color' })
    const dots = screen.getAllByRole('radio')
    expect(dots).toHaveLength(HIGHLIGHT_COLORS.length)
    expect(group.contains(dots[0])).toBe(true)
    expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual([
      'Yellow',
      'Green',
      'Blue',
      'Pink',
      'Orange',
      'Purple',
    ])
    expect(screen.getByRole('radio', { name: 'Blue' })).toHaveProperty(
      'ariaChecked',
      'true',
    )
    expect(screen.getByRole('radio', { name: 'Yellow' })).toHaveProperty(
      'ariaChecked',
      'false',
    )
    expect(
      screen
        .getByRole('radio', { name: 'Pink' })
        .style.getPropertyValue('--dot'),
    ).toBe('#ff8cc8')
  })

  it('reports a new pick and ignores a tap on the current one', () => {
    const onChange = vi.fn()
    render(<ColorDots value="yellow" onChange={onChange} label="Color" />)
    fireEvent.click(screen.getByRole('radio', { name: 'Yellow' }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }))
    expect(onChange).toHaveBeenCalledWith('green')
  })

  it('disables every dot when asked', () => {
    render(
      <ColorDots value="yellow" onChange={() => {}} label="Color" disabled />,
    )
    for (const dot of screen.getAllByRole('radio')) {
      expect((dot as HTMLButtonElement).disabled).toBe(true)
    }
  })
})
