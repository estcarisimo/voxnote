import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UpdateBar } from './UpdateBar'

describe('UpdateBar', () => {
  it('applies the update only when Reload is tapped', () => {
    const onReload = vi.fn(() => new Promise<void>(() => {}))
    render(<UpdateBar onReload={onReload} />)
    expect(screen.getByRole('status').textContent).toContain('Update available')
    expect(onReload).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onReload).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Reloading…' })
        .disabled,
    ).toBe(true)
  })

  it('hides without updating when dismissed', () => {
    const onReload = vi.fn(() => Promise.resolve())
    render(<UpdateBar onReload={onReload} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss update notice' }),
    )
    expect(screen.queryByRole('status')).toBeNull()
    expect(onReload).not.toHaveBeenCalled()
  })

  it('shows the error and allows a retry when the update fails', async () => {
    const onReload = vi.fn(() => Promise.reject(new Error('worker gone')))
    render(<UpdateBar onReload={onReload} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Update failed: worker gone',
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Reload' })
        .disabled,
    ).toBe(false)
  })
})
