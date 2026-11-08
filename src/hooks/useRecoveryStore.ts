import { useCallback, useEffect, useRef, useState } from 'react'
import { openRecoveryStore, type RecoveryStore } from '../core/recoveryStore'
import type { RecoverySource } from './useDraft'

export interface RecoveryStoreState extends RecoverySource {
  /**
   * The store once it is open, or null when opening failed (that failure is
   * already in `error`). A document opened before the store is ready waits
   * here instead of going unkept.
   */
  whenOpen(): Promise<RecoveryStore | null>
}

/**
 * Opens the crash-recovery store once for the app's lifetime. A failure is
 * reported, never hidden: the app still works, but cannot offer Resume or
 * keep drafts, and says so.
 */
export function useRecoveryStore(
  open: () => Promise<RecoveryStore> = () => openRecoveryStore(),
): RecoveryStoreState {
  const [source, setSource] = useState<RecoverySource>({
    store: null,
    error: null,
  })
  // Opened once: `open` is a test seam, read at mount only.
  const opener = useRef(open)
  // The outcome so far (undefined while opening) and who waits for it.
  const outcome = useRef<RecoveryStore | null | undefined>(undefined)
  const waiters = useRef<((store: RecoveryStore | null) => void)[]>([])

  useEffect(() => {
    let live = true
    let opened: RecoveryStore | null = null
    const settle = (store: RecoveryStore | null) => {
      outcome.current = store
      const waiting = waiters.current
      waiters.current = []
      for (const resolve of waiting) resolve(store)
    }
    opener.current().then(
      (store) => {
        if (!live) {
          store.close()
          return
        }
        opened = store
        setSource({ store, error: null })
        settle(store)
      },
      (err: unknown) => {
        if (!live) return
        setSource({
          store: null,
          error: `Crash recovery is off: local storage could not be opened (${err instanceof Error ? err.message : String(err)}). Saved annotations are not affected.`,
        })
        settle(null)
      },
    )
    return () => {
      live = false
      outcome.current = undefined
      opened?.close()
    }
  }, [])

  const whenOpen = useCallback(() => {
    if (outcome.current !== undefined) return Promise.resolve(outcome.current)
    return new Promise<RecoveryStore | null>((resolve) => {
      waiters.current.push(resolve)
    })
  }, [])

  return { ...source, whenOpen }
}
