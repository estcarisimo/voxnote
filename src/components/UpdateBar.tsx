import { useState } from 'react'
import './UpdateBar.css'

interface Props {
  /** Activates the waiting service worker and reloads the page. */
  onReload: () => Promise<void>
}

/**
 * Tells the user a new version of the app is ready. Nothing is applied until
 * they tap Reload; dismissing keeps the current version for this session.
 */
export function UpdateBar({ onReload }: Props) {
  const [dismissed, setDismissed] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (dismissed) return null

  function reload() {
    setReloading(true)
    setError(null)
    onReload().catch((err: unknown) => {
      setReloading(false)
      setError(
        `Update failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
  }

  return (
    <div className="update-bar" role="status">
      <span>Update available</span>
      <button type="button" onClick={reload} disabled={reloading}>
        {reloading ? 'Reloading…' : 'Reload'}
      </button>
      <button
        type="button"
        className="update-bar-dismiss"
        aria-label="Dismiss update notice"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
      {error && (
        <p role="alert" className="update-bar-error">
          {error}
        </p>
      )}
    </div>
  )
}
