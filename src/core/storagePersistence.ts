/**
 * Persistent storage for this origin. By default browsers keep IndexedDB in
 * "best-effort" mode and may evict it; Safari deletes all script-writable
 * storage of a site after seven days of Safari use without interaction,
 * except for a web app added to the Home Screen (docs/design/crash-recovery.md).
 * `navigator.storage.persist()` asks the browser to exempt this origin.
 *
 * Nothing here pretends: a browser without the API is reported as
 * `unavailable`, and a missing estimate as null, never as zero.
 */

/** granted: exempt from eviction; denied: best-effort; unavailable: no API. */
export type Persistence = 'granted' | 'denied' | 'unavailable'

export interface StorageStatus {
  persistence: Persistence
  /** Bytes used by this origin, per `estimate()`; null when unknown. */
  usage: number | null
  /** Bytes this origin may use, per `estimate()`; null when unknown. */
  quota: number | null
  /** True when this status came from a `persist()` request, not a check. */
  requested: boolean
  /** UTC ISO 8601. */
  checkedAt: string
}

/** The subset of StorageManager this module uses; injectable for tests. */
export type StorageApi = Partial<
  Pick<StorageManager, 'persist' | 'persisted' | 'estimate'>
>

/** The browser's StorageManager, or undefined where there is none. */
export function browserStorage(): StorageApi | undefined {
  return typeof navigator !== 'undefined' ? navigator.storage : undefined
}

async function estimate(
  storage: StorageApi | undefined,
): Promise<Pick<StorageStatus, 'usage' | 'quota'>> {
  if (typeof storage?.estimate !== 'function') {
    return { usage: null, quota: null }
  }
  const { usage, quota } = await storage.estimate()
  return { usage: usage ?? null, quota: quota ?? null }
}

/** The current mode and usage, without asking for anything. */
export async function readStorageStatus(
  storage: StorageApi | undefined,
  now = new Date(),
): Promise<StorageStatus> {
  const persistence: Persistence =
    typeof storage?.persisted !== 'function' ||
    typeof storage.persist !== 'function'
      ? 'unavailable'
      : (await storage.persisted())
        ? 'granted'
        : 'denied'
  return {
    persistence,
    ...(await estimate(storage)),
    requested: false,
    checkedAt: now.toISOString(),
  }
}

/** Asks the browser to make this origin's storage persistent. */
export async function requestPersistence(
  storage: StorageApi | undefined,
  now = new Date(),
): Promise<StorageStatus> {
  const persistence: Persistence =
    typeof storage?.persist !== 'function'
      ? 'unavailable'
      : (await storage.persist())
        ? 'granted'
        : 'denied'
  return {
    persistence,
    ...(await estimate(storage)),
    requested: true,
    checkedAt: now.toISOString(),
  }
}

/** "1.2 MB", "340 kB", "12 B": decimal units, one decimal above 10 kB. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}
