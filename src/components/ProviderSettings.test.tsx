import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Providers } from '../hooks/useProviders'
import {
  DEFAULT_SETTINGS,
  DEFAULT_TEXT_SETTINGS,
  type ProviderId,
} from '../providers/registry'
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

/** A fake store whose `hasKey` follows `setKey` and `removeKey`. */
function statefulProviders(initial: ProviderId[] = []) {
  const stored = new Set<ProviderId>(initial)
  const providers = providersWith({
    hasKey: (id) => stored.has(id),
    setKey: vi.fn(async (id: ProviderId) => {
      stored.add(id)
    }),
    removeKey: vi.fn(async (id: ProviderId) => {
      stored.delete(id)
    }),
  })
  return providers
}

function openAddRow() {
  fireEvent.click(screen.getByRole('button', { name: 'Add key' }))
  return screen.getByRole('form', { name: 'Add key' })
}

describe('ProviderSettings (AI keys)', () => {
  it('is titled "AI keys" and never says "Providers"', () => {
    render(<ProviderSettings providers={providersWith()} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'AI keys' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Providers/)
  })

  it('shows an empty state that says keys stay in this browser', () => {
    render(<ProviderSettings providers={providersWith()} onClose={() => {}} />)
    expect(screen.getByText(/No keys yet/).textContent).toMatch(
      /stay in this browser/,
    )
    expect(screen.queryByRole('list', { name: 'Stored keys' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add key' })).toBeTruthy()
    expect(screen.queryByRole('form', { name: 'Add key' })).toBeNull()
  })

  it('adds a key: the row appears, the key is never echoed, the add row collapses', async () => {
    const providers = statefulProviders()
    const { rerender } = render(
      <ProviderSettings providers={providers} onClose={() => {}} />,
    )
    const form = openAddRow()
    const field = within(form).getByLabelText(
      'OpenAI API key',
    ) as HTMLInputElement
    expect(field.type).toBe('password')
    expect(field.getAttribute('autocomplete')).toBe('off')

    // Save with nothing pasted: a loud message, no store call.
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(within(form).getByRole('alert').textContent).toMatch(/Paste a key/)
    expect(providers.setKey).not.toHaveBeenCalled()

    fireEvent.change(field, { target: { value: '  sk-test-123 ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(providers.setKey).toHaveBeenCalledWith('openai', '  sk-test-123 '),
    )
    // The app re-renders the dialog once the hook lists the new key.
    rerender(
      <ProviderSettings providers={{ ...providers }} onClose={() => {}} />,
    )
    expect(screen.queryByRole('form', { name: 'Add key' })).toBeNull()
    const row = screen.getByRole('listitem', { name: 'OpenAI key' })
    expect(row.textContent).toContain('••••')
    expect(row.textContent).toContain('Used for speech-to-text and clean-up')
    expect(document.body.textContent).not.toContain('sk-test')
    expect(screen.queryByText(/No keys yet/)).toBeNull()
  })

  it('lists only providers without a key in the add select, labeled by what they do', () => {
    const providers = statefulProviders(['openai'])
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    const form = openAddRow()
    const select = within(form).getByLabelText('Provider') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'anthropic',
      'xai',
    ])
    expect(select.options[0]?.textContent).toMatch(
      /Anthropic \(Claude\) — clean-up/,
    )
    fireEvent.change(select, { target: { value: 'xai' } })
    expect(within(form).getByLabelText('xAI (Grok) API key')).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Add key' })).toBeNull()
  })

  it('hides "Add key" once every provider has a key', () => {
    const providers = statefulProviders(['openai', 'anthropic', 'xai'])
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Add key' })).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('survives the render between storing the last key and collapsing the row', async () => {
    const providers = statefulProviders(['openai', 'anthropic'])
    const { rerender } = render(
      <ProviderSettings providers={providers} onClose={() => {}} />,
    )
    const form = openAddRow()
    fireEvent.change(within(form).getByLabelText('xAI (Grok) API key'), {
      target: { value: 'xai-test' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(providers.setKey).toHaveBeenCalledWith('xai', 'xai-test'),
    )
    // The hook lists the new key (a render with no provider left to add)
    // before the add row has collapsed itself.
    rerender(
      <ProviderSettings providers={{ ...providers }} onClose={() => {}} />,
    )
    expect(screen.queryByRole('form', { name: 'Add key' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add key' })).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('points clean-up at the first key that can serve it', async () => {
    const providers = statefulProviders()
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    const form = openAddRow()
    fireEvent.change(within(form).getByLabelText('Provider'), {
      target: { value: 'anthropic' },
    })
    fireEvent.change(
      within(form).getByLabelText('Anthropic (Claude) API key'),
      {
        target: { value: 'sk-ant-test' },
      },
    )
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await vi.waitFor(() =>
      expect(providers.setKey).toHaveBeenCalledWith('anthropic', 'sk-ant-test'),
    )
    expect(providers.saveTextSettings).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: '',
    })
    // Speech-to-text stays on OpenAI: Anthropic cannot transcribe.
    expect(providers.saveSettings).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('sk-ant-test')
  })

  it('removes a key only after an inline confirmation', async () => {
    const providers = statefulProviders(['openai'])
    const { rerender } = render(
      <ProviderSettings providers={providers} onClose={() => {}} />,
    )
    const row = screen.getByRole('listitem', { name: 'OpenAI key' })
    fireEvent.click(
      within(row).getByRole('button', { name: 'Remove OpenAI key' }),
    )
    expect(providers.removeKey).not.toHaveBeenCalled()
    const confirm = within(row).getByRole('group', { name: 'Confirm removal' })

    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep' }))
    expect(providers.removeKey).not.toHaveBeenCalled()
    expect(within(row).queryByRole('group')).toBeNull()

    fireEvent.click(
      within(row).getByRole('button', { name: 'Remove OpenAI key' }),
    )
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    await vi.waitFor(() =>
      expect(providers.removeKey).toHaveBeenCalledWith('openai'),
    )
    rerender(
      <ProviderSettings providers={{ ...providers }} onClose={() => {}} />,
    )
    expect(screen.queryByRole('listitem', { name: 'OpenAI key' })).toBeNull()
    expect(screen.getByText(/No keys yet/)).toBeTruthy()
  })

  it('moves clean-up to the remaining key when its provider is removed', async () => {
    const providers = statefulProviders(['openai', 'anthropic'])
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    const row = screen.getByRole('listitem', { name: 'OpenAI key' })
    fireEvent.click(
      within(row).getByRole('button', { name: 'Remove OpenAI key' }),
    )
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    await vi.waitFor(() =>
      expect(providers.removeKey).toHaveBeenCalledWith('openai'),
    )
    expect(providers.saveTextSettings).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: '',
    })
  })

  it('offers a clean-up selector only when more than one key can clean up', () => {
    const one = statefulProviders(['openai'])
    const { unmount } = render(
      <ProviderSettings providers={one} onClose={() => {}} />,
    )
    expect(screen.queryByLabelText('Use for clean-up')).toBeNull()
    expect(screen.queryByLabelText('Use for speech-to-text')).toBeNull()
    unmount()

    const two = statefulProviders(['openai', 'xai'])
    render(<ProviderSettings providers={two} onClose={() => {}} />)
    const select = screen.getByLabelText(
      'Use for clean-up',
    ) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      'openai',
      'xai',
    ])
    expect(
      screen.getByRole('listitem', { name: 'xAI (Grok) key' }).textContent,
    ).toContain('Not in use (can do clean-up)')
    fireEvent.change(select, { target: { value: 'xai' } })
    expect(two.saveTextSettings).toHaveBeenCalledWith({
      provider: 'xai',
      model: '',
    })
  })

  it('shows the model selects on the row that is in use, with the provider models', () => {
    const providers = statefulProviders(['openai', 'anthropic'])
    providers.textSettings = { provider: 'anthropic', model: 'claude-opus-5-5' }
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    const openai = screen.getByRole('listitem', { name: 'OpenAI key' })
    const anthropic = screen.getByRole('listitem', {
      name: 'Anthropic (Claude) key',
    })
    expect(openai.textContent).toContain('Used for speech-to-text')
    expect(anthropic.textContent).toContain('Used for clean-up')
    expect(within(openai).queryByLabelText('Clean-up model')).toBeNull()

    fireEvent.change(within(openai).getByLabelText('Speech-to-text model'), {
      target: { value: 'whisper-1' },
    })
    expect(providers.saveSettings).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      model: 'whisper-1',
    })

    const model = within(anthropic).getByLabelText(
      'Clean-up model',
    ) as HTMLSelectElement
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
  })

  it('saves the language hint on blur, not per keystroke', () => {
    const providers = providersWith()
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    const language = screen.getByLabelText(/Language hint/) as HTMLInputElement
    fireEvent.change(language, { target: { value: 'E' } })
    fireEvent.change(language, { target: { value: 'ES' } })
    expect(language.value).toBe('ES')
    expect(providers.saveSettings).not.toHaveBeenCalled()
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

  it('closes on Escape and starts with focus inside the dialog', () => {
    const onClose = vi.fn()
    render(<ProviderSettings providers={providersWith()} onClose={onClose} />)
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(
      true,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('surfaces a failed save inside the add row', async () => {
    const providers = providersWith({
      setKey: vi.fn(async () => {
        throw new Error('The secret store is not ready')
      }),
    })
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    const form = openAddRow()
    fireEvent.change(within(form).getByLabelText('OpenAI API key'), {
      target: { value: 'k' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await within(form).findByRole('alert')).toHaveProperty(
      'textContent',
      'The secret store is not ready',
    )
    // The row stays open so the user can retry.
    expect(screen.getByRole('form', { name: 'Add key' })).toBeTruthy()
  })

  it('surfaces a failed removal and keeps the row', async () => {
    const providers = providersWith({
      hasKey: (id) => id === 'openai',
      removeKey: vi.fn(async () => {
        throw new Error('The secret store is not ready')
      }),
    })
    render(<ProviderSettings providers={providers} onClose={() => {}} />)
    const row = screen.getByRole('listitem', { name: 'OpenAI key' })
    fireEvent.click(
      within(row).getByRole('button', { name: 'Remove OpenAI key' }),
    )
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    expect(await within(row).findByRole('alert')).toHaveProperty(
      'textContent',
      'The secret store is not ready',
    )
    expect(
      within(row).getByRole('button', { name: 'Remove OpenAI key' }),
    ).toBeTruthy()
  })

  it('keeps focus where it is when the parent re-renders with new props', () => {
    const providers = providersWith()
    const { rerender } = render(
      <ProviderSettings providers={providers} onClose={() => {}} />,
    )
    const form = openAddRow()
    const keyField = within(form).getByLabelText('OpenAI API key')
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
