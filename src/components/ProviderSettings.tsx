import { useState, type FormEvent } from 'react'
import type { Providers } from '../hooks/useProviders'
import { MODELS, PROVIDER_LABELS } from '../providers/registry'
import './Dialog.css'

interface ProviderSettingsProps {
  providers: Providers
  onClose: () => void
}

/**
 * Where the user enters their own API key. The key is encrypted at rest in
 * this browser and shown nowhere after saving; it is sent only to the
 * provider, only when the user confirms an upload.
 */
export function ProviderSettings({
  providers,
  onClose,
}: ProviderSettingsProps) {
  const { settings } = providers
  const provider = settings.provider
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const hasKey = providers.hasKey(provider)

  async function saveKey(event: FormEvent) {
    event.preventDefault()
    if (key.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      await providers.setKey(provider, key)
      setKey('')
      setSaved(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function removeKey() {
    setBusy(true)
    setError(null)
    try {
      await providers.removeKey(provider)
      setSaved(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="provider-settings-title">Speech-to-text provider</h2>
        <p className="dialog-note">
          Your key is encrypted in this browser and never leaves it except in
          requests you confirm, sent straight to the provider. VoxNote has no
          server.
        </p>

        <label className="dialog-field">
          <span>Provider</span>
          <select
            value={provider}
            onChange={(e) =>
              providers.saveSettings({
                ...settings,
                provider: e.target.value as typeof provider,
              })
            }
          >
            {Object.entries(PROVIDER_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="dialog-field">
          <span>Model</span>
          <select
            value={settings.model}
            onChange={(e) =>
              providers.saveSettings({ ...settings, model: e.target.value })
            }
          >
            {MODELS[provider].map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="dialog-field">
          <span>Language hint (optional, e.g. es, en)</span>
          <input
            type="text"
            value={settings.language}
            placeholder="auto-detect"
            onChange={(e) =>
              providers.saveSettings({ ...settings, language: e.target.value })
            }
          />
        </label>

        <form onSubmit={saveKey} className="dialog-field">
          <span>
            {PROVIDER_LABELS[provider]} API key
            {hasKey ? ' · a key is stored' : ' · none stored'}
          </span>
          <div className="dialog-row">
            <input
              type="password"
              aria-label="API key"
              autoComplete="off"
              spellCheck={false}
              value={key}
              placeholder={hasKey ? 'Replace the stored key' : 'Paste your key'}
              onChange={(e) => setKey(e.target.value)}
              disabled={!providers.ready || busy}
            />
            <button
              type="submit"
              className="is-primary"
              disabled={!providers.ready || busy || key.trim() === ''}
            >
              Save key
            </button>
            {hasKey && (
              <button type="button" onClick={removeKey} disabled={busy}>
                Remove key
              </button>
            )}
          </div>
        </form>

        {saved && <p className="dialog-ok">Key saved.</p>}
        {(error || providers.error) && (
          <p role="alert" className="dialog-error">
            {error ?? providers.error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
