import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AiKeysButton } from './AiKeysButton'

describe('AiKeysButton', () => {
  it('reads "AI keys", carries a decorative key icon and reports its state', () => {
    const onClick = vi.fn()
    render(<AiKeysButton pressed={false} onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'AI keys' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.querySelector('svg[aria-hidden="true"]')).toBeTruthy()
    expect(button.textContent).not.toMatch(/Providers/)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('shows as pressed while the dialog is open', () => {
    render(<AiKeysButton pressed={true} onClick={() => {}} />)
    expect(
      screen
        .getByRole('button', { name: 'AI keys' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
  })
})
