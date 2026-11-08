import { useEffect, useRef, useState } from 'react'
import { openRecoveryStore, type RecoveryStore } from '../core/recoveryStore'
import type { RecoverySource } from './useDraft'

/**
 * Opens the crash-recovery store once for the app's lifetime. A failure is
 * reported, never hidden: the app still works, but cannot offer Resume or
 * keep drafts, and says so.
 */
export function useRecoveryStore(
  open: () => Promise<RecoveryStore> = () => openRecoveryStore(),
): RecoverySource {
  const [source, setSource] = useState<RecoverySource>({
    store: null,
    error: null,
  })
  // Opened once: `open` is a test seam, read at mount only.
  const opener = useRef(open)
  useEffect(() => {
    let live = true
    let opened: RecoveryStore | null = null
    opener.current().then(
      (store) => {
        if (!live) {
          store.close()
          return
        }
        opened = store
        setSource({ store, error: null })
      },
      (err: unknown) => {
        if (!live) return
        setSource({
          store: null,
          error: `Crash recovery is off: local storage could not be opened (${err instanceof Error ? err.message : String(err)}). Saved annotations are not affected.`,
        })
      },
    )
    return () => {
      live = false
      opened?.close()
    }
  }, [])
  return source
}
