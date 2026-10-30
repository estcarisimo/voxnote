import { useRef, useState, type FormEvent } from 'react'
import { useDialogFocus } from '../hooks/useDialogFocus'
import type { Providers } from '../hooks/useProviders'
import {
  isLanguageHint,
  isSttProviderId,
  isTextProviderId,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  STT_MODELS,
  STT_PROVIDER_IDS,
  TEXT_MODELS,
  TEXT_PROVIDER_IDS,
  type ProviderId,
  type SttProviderId,
  type TextProviderId,
} from '../providers/registry'
import './Dialog.css'
import './ProviderSettings.css'

interface ProviderSettingsProps {
  providers: Providers
  onClose: () => void
}

/** What a key can be used for, in the words the consent dialogs use. */
type Role = 'speech-to-text' | 'clean-up'

const ROLE_LABELS: Record<Role, string> = {
  'speech-to-text': 'Speech-to-text',
  'clean-up': 'Clean-up',
}

/** The roles a provider can serve, whether or not it is picked for them. */
function rolesOf(id: ProviderId): Role[] {
  const roles: Role[] = []
  if (isSttProviderId(id)) roles.push('speech-to-text')
  if (isTextProviderId(id)) roles.push('clean-up')
  return roles
}

function describeRoles(roles: readonly Role[]): string {
  const [first, ...rest] = roles.map((r) => ROLE_LABELS[r])
  if (!first) return ''
  if (rest.length === 0) return first
  return `${first} and ${rest.join(' and ').toLowerCase()}`
}

/**
 * The "AI keys" dialog: the keys stored in this browser, one row per
 * provider, what each is used for, and a way to add or remove one. Keys are
 * encrypted at rest and shown nowhere after saving; each is sent only to its
 * own provider, only in a request the user confirms.
 */
export function ProviderSettings({
  providers,
  onClose,
}: ProviderSettingsProps) {
  const { settings, textSettings } = providers
  const [language, setLanguage] = useState(settings.language)
  const [languageError, setLanguageError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, onClose)

  const stored = PROVIDER_IDS.filter((id) => providers.hasKey(id))
  const missing = PROVIDER_IDS.filter((id) => !providers.hasKey(id))
  const sttCandidates = STT_PROVIDER_IDS.filter((id) => providers.hasKey(id))
  const textCandidates = TEXT_PROVIDER_IDS.filter((id) => providers.hasKey(id))

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

  function pickForSpeechToText(id: SttProviderId) {
    if (id === settings.provider) return
    providers.saveSettings({ ...settings, provider: id, model: '' })
  }

  function pickForCleanUp(id: TextProviderId) {
    if (id === textSettings.provider) return
    // The model falls back to the new provider's default.
    providers.saveTextSettings({ provider: id, model: '' })
  }

  /**
   * A role whose picked provider has no key is pointed at the key that can
   * serve it, so a first Anthropic key cleans up without a second step.
   */
  function pickRolesFor(id: ProviderId) {
    if (isSttProviderId(id) && !providers.hasKey(settings.provider)) {
      pickForSpeechToText(id)
    }
    if (isTextProviderId(id) && !providers.hasKey(textSettings.provider)) {
      pickForCleanUp(id)
    }
  }

  /** After a removal, a role left without a key moves to the next key. */
  function releaseRolesOf(id: ProviderId) {
    if (settings.provider === id) {
      const next = sttCandidates.find((c) => c !== id)
      if (next) pickForSpeechToText(next)
    }
    if (textSettings.provider === id) {
      const next = textCandidates.find((c) => c !== id)
      if (next) pickForCleanUp(next)
    }
  }

  function activeRolesOf(id: ProviderId): Role[] {
    const roles: Role[] = []
    if (settings.provider === id) roles.push('speech-to-text')
    if (textSettings.provider === id) roles.push('clean-up')
    return roles
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-keys-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="ai-keys-title">AI keys</h2>

        {stored.length === 0 ? (
          <p className="keys-empty">
            No keys yet. Keys stay in this browser, encrypted, and are used only
            when you transcribe a voice note or clean one up.
          </p>
        ) : (
          <ul className="keys-list" aria-label="Stored keys">
            {stored.map((id) => (
              <KeyRow
                key={id}
                id={id}
                providers={providers}
                activeRoles={activeRolesOf(id)}
                onRemoved={() => releaseRolesOf(id)}
              />
            ))}
          </ul>
        )}

        {sttCandidates.length > 1 && (
          <label className="keys-role">
            <span>Use for speech-to-text</span>
            <select
              value={settings.provider}
              onChange={(e) => {
                const value: unknown = e.target.value
                if (!isSttProviderId(value)) {
                  throw new Error(
                    `Unknown speech-to-text provider "${String(value)}"`,
                  )
                }
                pickForSpeechToText(value)
              }}
            >
              {sttCandidates.map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
        )}

        {textCandidates.length > 1 && (
          <label className="keys-role">
            <span>Use for clean-up</span>
            <select
              value={textSettings.provider}
              onChange={(e) => {
                const value: unknown = e.target.value
                if (!isTextProviderId(value)) {
                  throw new Error(
                    `Unknown clean-up provider "${String(value)}"`,
                  )
                }
                pickForCleanUp(value)
              }}
            >
              {textCandidates.map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
        )}

        {adding && missing.length > 0 ? (
          <AddKeyRow
            candidates={missing}
            providers={providers}
            onSaved={(id) => {
              pickRolesFor(id)
              setAdding(false)
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          missing.length > 0 && (
            <button
              type="button"
              className="keys-add is-primary"
              onClick={() => setAdding(true)}
              disabled={!providers.ready}
            >
              Add key
            </button>
          )
        )}

        <label className="dialog-field keys-language">
          <span>
            Language hint (optional, e.g. es, en; sent with transcriptions and
            clean-ups)
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

/**
 * One stored key: provider, what it is used for, the model for each role it
 * is picked for, and removal behind an inline confirmation. The key itself
 * is never read here; a fixed "••••" stands in for it.
 */
function KeyRow({
  id,
  providers,
  activeRoles,
  onRemoved,
}: {
  id: ProviderId
  providers: Providers
  activeRoles: readonly Role[]
  onRemoved: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = PROVIDER_LABELS[id]
  const { settings, textSettings } = providers
  const canDo = rolesOf(id)
  const usedFor =
    activeRoles.length > 0
      ? `Used for ${describeRoles(activeRoles).toLowerCase()}`
      : `Not in use (can do ${describeRoles(canDo).toLowerCase()})`

  async function removeKey() {
    setBusy(true)
    setError(null)
    try {
      await providers.removeKey(id)
      onRemoved()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <li className="keys-row" aria-label={`${label} key`}>
      <div className="keys-row-head">
        <div className="keys-row-text">
          <strong>{label}</strong>
          <span className="keys-row-uses">
            <span className="keys-mask" aria-hidden="true">
              ••••
            </span>
            {usedFor}
          </span>
        </div>
        {!confirming && (
          <button
            type="button"
            className="keys-trash"
            aria-label={`Remove ${label} key`}
            title={`Remove ${label} key`}
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            <TrashIcon />
          </button>
        )}
      </div>

      {confirming && (
        <div className="keys-confirm" role="group" aria-label="Confirm removal">
          <span>Remove the {label} key from this browser?</span>
          <button
            type="button"
            className="is-danger"
            disabled={busy}
            onClick={() => void removeKey()}
          >
            Remove
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Keep
          </button>
        </div>
      )}

      {activeRoles.includes('speech-to-text') && isSttProviderId(id) && (
        <label className="keys-model">
          <span>Speech-to-text model</span>
          <select
            value={settings.model}
            onChange={(e) =>
              providers.saveSettings({ ...settings, model: e.target.value })
            }
          >
            {STT_MODELS[id].map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {activeRoles.includes('clean-up') && isTextProviderId(id) && (
        <label className="keys-model">
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
            {TEXT_MODELS[id].map((m) => (
              <option key={m.id} value={m.id}>
                {m.deprecated
                  ? `${m.label} (deprecated ${m.deprecated})`
                  : m.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <span role="alert" className="dialog-error">
          {error}
        </span>
      )}
    </li>
  )
}

/** The inline form that stores one new key; the field is cleared on save. */
function AddKeyRow({
  candidates,
  providers,
  onSaved,
  onCancel,
}: {
  candidates: readonly ProviderId[]
  providers: Providers
  onSaved: (id: ProviderId) => void
  onCancel: () => void
}) {
  // Rendered only while some provider has no key; the guard is for types.
  const first = candidates[0]
  if (first === undefined) {
    throw new Error('Every provider already has a key')
  }
  const [id, setId] = useState<ProviderId>(first)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (key.trim() === '') {
      setError('Paste a key before saving')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await providers.setKey(id, key)
      setKey('')
      onSaved(id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <form className="keys-add-row" aria-label="Add key" onSubmit={save}>
      <label className="dialog-field">
        <span>Provider</span>
        <select
          value={id}
          onChange={(e) => {
            const value = e.target.value
            if (!candidates.includes(value as ProviderId)) {
              throw new Error(`Unknown provider "${value}"`)
            }
            setId(value as ProviderId)
          }}
        >
          {candidates.map((c) => (
            <option key={c} value={c}>
              {PROVIDER_LABELS[c]} — {describeRoles(rolesOf(c)).toLowerCase()}
            </option>
          ))}
        </select>
      </label>
      <label className="dialog-field">
        <span>{PROVIDER_LABELS[id]} API key</span>
        <input
          type="password"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={key}
          placeholder="Paste your key"
          onChange={(e) => {
            setKey(e.target.value)
            if (error) setError(null)
          }}
          disabled={!providers.ready || busy}
        />
      </label>
      {error && (
        <span role="alert" className="dialog-error">
          {error}
        </span>
      )}
      <div className="dialog-row">
        <button
          type="submit"
          className="is-primary"
          disabled={!providers.ready || busy}
        >
          Save
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}
