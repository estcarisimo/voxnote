import { useRef, useState, type FormEvent } from 'react'
import { useDialogFocus } from '../hooks/useDialogFocus'
import type { Providers } from '../hooks/useProviders'
import {
  isLanguageHint,
  isTextProviderId,
  PROVIDER_LABELS,
  STT_MODELS,
  STT_PROVIDER_IDS,
  TEXT_MODELS,
  TEXT_PROVIDER_IDS,
  type ProviderId,
} from '../providers/registry'
import './Dialog.css'

interface ProviderSettingsProps {
  providers: Providers
  onClose: () => void
}

/**
 * Where the user picks a speech-to-text provider, a clean-up provider, and
 * enters their own API keys. Each key is encrypted at rest in this browser
 * and shown nowhere after saving; it is sent only to its provider, only when
 * the user confirms a request.
 */
export function ProviderSettings({
  providers,
  onClose,
}: ProviderSettingsProps) {
  const { settings, textSettings } = providers
  const [language, setLanguage] = useState(settings.language)
  const [languageError, setLanguageError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, onClose)

  /** Validates on blur or Enter, not per keystroke, so "es" can be typed. */
  function commitLanguage() {
    const value = language.trim().toLowerCase()
    if (!isLanguageHint(value)) {
      setLanguageError(
        `"${language}" is not a language code; use ISO 639-1 such as es or en, or leave it empty`,
      )
      return
    }
    setLanguageError(null)
    setLanguage(value)
    if (value !== settings.language) {
      providers.saveSettings({ ...settings, language: value })
    }
  }

  // Keys for the providers in use first, then the rest.
  const inUse = new Set<ProviderId>([settings.provider, textSettings.provider])
  const keyOrder = (Object.keys(PROVIDER_LABELS) as ProviderId[]).sort(
    (a, b) => Number(inUse.has(b)) - Number(inUse.has(a)),
  )

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="provider-settings-title">Providers</h2>
        <p className="dialog-note">
          Your keys are encrypted in this browser and never leave it except in
          requests you confirm, sent straight to the provider. VoxNote has no
          server.
        </p>

        <h3>Speech-to-text</h3>
        <label className="dialog-field">
          <span>Speech-to-text provider</span>
          <select
            value={settings.provider}
            onChange={(e) =>
              providers.saveSettings({
                ...settings,
                provider: e.target.value as typeof settings.provider,
              })
            }
          >
            {STT_PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_LABELS[id]}
              </option>
            ))}
          </select>
        </label>

        <label className="dialog-field">
          <span>Transcription model</span>
          <select
            value={settings.model}
            onChange={(e) =>
              providers.saveSettings({ ...settings, model: e.target.value })
            }
          >
            {STT_MODELS[settings.provider].map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="dialog-field">
          <span>
            Language hint (optional, e.g. es, en; also sent with clean-ups)
          </span>
          <input
            type="text"
            value={language}
            placeholder="auto-detect"
            aria-invalid={languageError !== null}
            onChange={(e) => setLanguage(e.target.value)}
            onBlur={commitLanguage}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitLanguage()
              }
            }}
          />
          {languageError && (
            <span role="alert" className="dialog-error">
              {languageError}
            </span>
          )}
        </label>

        <h3>Text clean-up (optional)</h3>
        <label className="dialog-field">
          <span>Clean-up provider</span>
          <select
            value={textSettings.provider}
            onChange={(e) => {
              const value: unknown = e.target.value
              if (!isTextProviderId(value)) {
                throw new Error(`Unknown text provider "${String(value)}"`)
              }
              // The model falls back to the new provider's default.
              providers.saveTextSettings({ provider: value, model: '' })
            }}
          >
            {TEXT_PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_LABELS[id]}
              </option>
            ))}
          </select>
        </label>

        <label className="dialog-field">
          <span>Clean-up model</span>
          <select
            value={textSettings.model}
            onChange={(e) =>
              providers.saveTextSettings({
                ...textSettings,
                model: e.target.value,
              })
            }
          >
            {TEXT_MODELS[textSettings.provider].map((m) => (
              <option key={m.id} value={m.id}>
                {m.deprecated
                  ? `${m.label} (deprecated ${m.deprecated})`
                  : m.label}
              </option>
            ))}
          </select>
        </label>

        <h3>API keys</h3>
        {keyOrder.map((id) => (
          <KeyForm
            key={id}
            id={id}
            providers={providers}
            usedFor={[
              settings.provider === id ? 'speech-to-text' : null,
              textSettings.provider === id ? 'clean-up' : null,
            ].filter((u): u is string => u !== null)}
          />
        ))}

        {providers.error && (
          <p role="alert" className="dialog-error">
            {providers.error}
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

/** One provider's key: save, replace or remove; never shown back. */
function KeyForm({
  id,
  providers,
  usedFor,
}: {
  id: ProviderId
  providers: Providers
  usedFor: string[]
}) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const hasKey = providers.hasKey(id)
  const label = PROVIDER_LABELS[id]

  async function saveKey(event: FormEvent) {
    event.preventDefault()
    if (key.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      await providers.setKey(id, key)
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
      await providers.removeKey(id)
      setSaved(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={saveKey}
      className="dialog-field"
      aria-label={`${label} key`}
    >
      <span>
        {label} API key
        {usedFor.length > 0 && ` (used for ${usedFor.join(' and ')})`}
        {hasKey ? ' · a key is stored' : ' · none stored'}
      </span>
      <div className="dialog-row">
        <input
          type="password"
          aria-label={`${label} API key`}
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
      {saved && <span className="dialog-ok">Key saved.</span>}
      {error && (
        <span role="alert" className="dialog-error">
          {error}
        </span>
      )}
    </form>
  )
}
