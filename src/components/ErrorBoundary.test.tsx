import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Broken(): never {
  throw new Error('page 3 has no viewport')
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the error and a Reload button instead of a blank page', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onReload = vi.fn()
    render(
      <ErrorBoundary label="The viewer" onReload={onReload}>
        <Broken />
      </ErrorBoundary>,
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(
      'The viewer stopped because of an error',
    )
    expect(alert.textContent).toContain('page 3 has no viewport')
    expect(alert.textContent).toContain('kept on this device')
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onReload).toHaveBeenCalledTimes(1)
    // Loud: the error reaches the console for a bug report.
    expect(consoleError).toHaveBeenCalled()
  })

  it('renders its children when nothing fails', () => {
    render(
      <ErrorBoundary label="The viewer">
        <p>fine</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeTruthy()
  })
})
