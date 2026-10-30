import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Providers } from '../hooks/useProviders'
import { DEFAULT_SETTINGS, DEFAULT_TEXT_SETTINGS } from '../providers/registry'
import { ProviderSettings } from './ProviderSettings'

function providersWith(overrides: Partial<Providers> = {}): Providers {
  return {
    ready: true,
    error: null,
    settings: DEFAULT_SETTINGS,
    saveSettings: vi.fn(),
    textSettings: DEFAULT_TEXT_SETTINGS,
    saveTextSettings: vi.fn(),
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
    const field = screen.getByLabelText('OpenAI API key') as HTMLInputElement
    expect(field.type).toBe('password')
    const form = screen.getByRole('form', { name: 'OpenAI key' })
    expect(form.textContent).toMatch(/none stored/)
    const save = within(form).getByRole('button', { name: 'Save key' })
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
    const providers = providersWith({ hasKey: (id) => id === 'openai' })
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    const form = screen.getByRole('form', { name: 'OpenAI key' })
    expect(form.textContent).toMatch(/a key is stored/)
    expect(
      screen.getByRole('form', { name: 'xAI (Grok) key' }).textContent,
    ).toMatch(/none stored/)
    fireEvent.click(within(form).getByRole('button', { name: 'Remove key' }))
    await vi.waitFor(() =>
      expect(providers.removeKey).toHaveBeenCalledWith('openai'),
    )
  })

  it('saves model and language hint as settings', () => {
    const providers = providersWith()
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Transcription model'), {
      target: { value: 'whisper-1' },
    })
    expect(providers.saveSettings).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      model: 'whisper-1',
    })
    // Typed letter by letter: nothing is saved or reset until blur.
    const language = screen.getByLabelText(/Language hint/) as HTMLInputElement
    fireEvent.change(language, { target: { value: 'E' } })
    fireEvent.change(language, { target: { value: 'ES' } })
    expect(language.value).toBe('ES')
    expect(providers.saveSettings).toHaveBeenCalledTimes(1)
    fireEvent.blur(language)
    expect(language.value).toBe('es')
    expect(providers.saveSettings).toHaveBeenLastCalledWith({
      ...DEFAULT_SETTINGS,
      language: 'es',
    })
  })

  it('rejects a language hint that is not a code, loudly, without saving it', () => {
    const providers = providersWith()
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    const language = screen.getByLabelText(/Language hint/) as HTMLInputElement
    fireEvent.change(language, { target: { value: 'spanish' } })
    fireEvent.keyDown(language, { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toMatch(/not a language code/)
    expect(language.getAttribute('aria-invalid')).toBe('true')
    expect(providers.saveSettings).not.toHaveBeenCalled()
    fireEvent.change(language, { target: { value: '' } })
    fireEvent.blur(language)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('picks the clean-up provider and model, and keeps one key per provider', async () => {
    const providers = providersWith({
      textSettings: { provider: 'anthropic', model: 'claude-opus-5-5' },
    })
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    const model = screen.getByLabelText('Clean-up model') as HTMLSelectElement
    expect(Array.from(model.options).map((o) => o.value)).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-fable-5-1',
    ])
    fireEvent.change(model, { target: { value: 'claude-haiku-5-5' } })
    expect(providers.saveTextSettings).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
    })
    fireEvent.change(screen.getByLabelText('Clean-up provider'), {
      target: { value: 'xai' },
    })
    expect(providers.saveTextSettings).toHaveBeenLastCalledWith({
      provider: 'xai',
      model: '',
    })

    const anthropic = screen.getByRole('form', {
      name: 'Anthropic (Claude) key',
    })
    expect(anthropic.textContent).toContain('used for clean-up')
    expect(
      screen.getByRole('form', { name: 'OpenAI key' }).textContent,
    ).toContain('used for speech-to-text')
    fireEvent.change(
      within(anthropic).getByLabelText('Anthropic (Claude) API key'),
      {
        target: { value: 'sk-ant-test' },
      },
    )
    fireEvent.click(within(anthropic).getByRole('button', { name: 'Save key' }))
    await vi.waitFor(() =>
      expect(providers.setKey).toHaveBeenCalledWith('anthropic', 'sk-ant-test'),
    )
    expect(document.body.textContent).not.toContain('sk-ant-test')
  })

  it('closes on Escape and starts with focus inside the dialog', () => {
    const onClose = vi.fn()
    render(<ProviderSettings providers={providersWith()} onClose={onClose} />)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(
      true,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('surfaces a failed save', async () => {
    const providers = providersWith({
      setKey: vi.fn(async () => {
        throw new Error('The secret store is not ready')
      }),
    })
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('OpenAI API key'), {
      target: { value: 'k' },
    })
    fireEvent.click(
      within(screen.getByRole('form', { name: 'OpenAI key' })).getByRole(
        'button',
        { name: 'Save key' },
      ),
    )
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'The secret store is not ready',
    )
  })

  it('keeps focus where it is when the parent re-renders with new props', () => {
    const providers = providersWith()
    const { rerender } = render(
      <ProviderSettings providers={providers} onClose={() => {}} />,
    )
    const keyField = screen.getByLabelText('OpenAI API key')
    keyField.focus()
    // What committing the language does in the app: settings change, the
    // parent re-renders, and every callback prop is a fresh closure.
    rerender(
      <ProviderSettings
        providers={{
          ...providers,
          settings: { ...providers.settings, language: 'es' },
        }}
        onClose={() => {}}
      />,
    )
    expect(document.activeElement).toBe(keyField)
  })
})
