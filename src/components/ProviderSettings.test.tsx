import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Providers } from '../hooks/useProviders'
import { DEFAULT_SETTINGS } from '../providers/registry'
import { ProviderSettings } from './ProviderSettings'

function providersWith(overrides: Partial<Providers> = {}): Providers {
  return {
    ready: true,
    error: null,
    settings: DEFAULT_SETTINGS,
    saveSettings: vi.fn(),
    hasKey: () => false,
    setKey: vi.fn(async () => {}),
    removeKey: vi.fn(async () => {}),
    readKey: vi.fn(async () => null),
    ...overrides,
  }
}

describe('ProviderSettings', () => {
  it('saves a key through the store, never echoing it, and clears the field', async () => {
    const providers = providersWith()
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    const field = screen.getByLabelText('API key') as HTMLInputElement
    expect(field.type).toBe('password')
    expect(screen.getByText(/none stored/)).toBeTruthy()
    const save = screen.getByRole('button', { name: 'Save key' })
    expect(save).toHaveProperty('disabled', true)

    fireEvent.change(field, { target: { value: '  sk-test-123 ' } })
    fireEvent.click(save)
    await vi.waitFor(() =>
      expect(providers.setKey).toHaveBeenCalledWith('openai', '  sk-test-123 '),
    )
    await screen.findByText('Key saved.')
    expect(field.value).toBe('')
    expect(document.body.textContent).not.toContain('sk-test')
  })

  it('shows that a key is stored and can remove it', async () => {
    const providers = providersWith({ hasKey: () => true })
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    expect(screen.getByText(/a key is stored/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }))
    await vi.waitFor(() =>
      expect(providers.removeKey).toHaveBeenCalledWith('openai'),
    )
  })

  it('saves model and language hint as settings', () => {
    const providers = providersWith()
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'whisper-1' },
    })
    expect(providers.saveSettings).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      model: 'whisper-1',
    })
    fireEvent.change(screen.getByLabelText(/Language hint/), {
      target: { value: 'es' },
    })
    expect(providers.saveSettings).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      language: 'es',
    })
  })

  it('surfaces a failed save', async () => {
    const providers = providersWith({
      setKey: vi.fn(async () => {
        throw new Error('The secret store is not ready')
      }),
    })
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('API key'), {
      target: { value: 'k' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'The secret store is not ready',
    )
  })
})
