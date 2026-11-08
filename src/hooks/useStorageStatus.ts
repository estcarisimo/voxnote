import { useCallback, useRef, useState } from 'react'
import {
  browserStorage,
  readStorageStatus,
  requestPersistence,
  type StorageApi,
  type StorageStatus,
} from '../core/storagePersistence'

export interface StorageStatusState {
  /** Null until first read. */
  status: StorageStatus | null
  /** Reads the mode and usage again, without requesting anything. */
  refresh(): Promise<StorageStatus>
  /**
   * Requests persistent storage, once per page load, unless it is already
   * granted. Resolves with the outcome; rejects when the browser's call
   * fails.
   */
  ensurePersistent(): Promise<StorageStatus>
}

/** The origin's storage mode and usage, and the request to make it persistent. */
export function useStorageStatus(
  storage: StorageApi | undefined = browserStorage(),
): StorageStatusState {
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const api = useRef(storage)
  const asked = useRef<Promise<StorageStatus> | null>(null)

  const refresh = useCallback(async () => {
    const next = await readStorageStatus(api.current)
    // A check never hides the outcome of an earlier request.
    setStatus((previous) =>
      previous?.requested && next.persistence === previous.persistence
        ? { ...next, requested: true, checkedAt: previous.checkedAt }
        : next,
    )
    return next
  }, [])

  const ensurePersistent = useCallback(() => {
    asked.current ??= (async () => {
      const current = await readStorageStatus(api.current)
      const outcome =
        current.persistence === 'granted'
          ? current
          : await requestPersistence(api.current)
      setStatus(outcome)
      return outcome
    })()
    return asked.current
  }, [])

  return { status, refresh, ensurePersistent }
}
