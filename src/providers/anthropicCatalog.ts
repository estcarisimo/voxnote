/**
 * The Claude models VoxNote offers for Polish and Ask: the newest model of
 * each family that the user's key can use, as Anthropic last listed them,
 * or the built-in list until the user asks. Kept in localStorage (model ids
 * and names only, never the key) so the menu survives a reload and follows
 * Anthropic's releases without a VoxNote release.
 *
 * Nothing here contacts Anthropic by itself: `refreshAnthropicCatalog` runs
 * only when the user taps the button that says what it sends.
 */
import { newestPerFamily } from '../core/claudeModels'
import { ANTHROPIC_TEXT_MODELS, listAnthropicModels } from './anthropic'
import type { TextModelInfo } from './llm'

export const ANTHROPIC_CATALOG_KEY = 'voxnote.anthropic.models'

export interface AnthropicCatalog {
  models: readonly TextModelInfo[]
  /** UTC ISO time of the listing; null for the built-in list. */
  fetchedAt: string | null
}

const BUILT_IN: AnthropicCatalog = {
  models: ANTHROPIC_TEXT_MODELS,
  fetchedAt: null,
}

let current: AnthropicCatalog | null = null
const listeners = new Set<() => void>()

/** The catalog now in use; read once from storage, then kept in memory. */
export function anthropicCatalog(): AnthropicCatalog {
  current ??= loadCatalog()
  return current
}

/** The models the menu offers, newest of each family. */
export function anthropicModels(): readonly TextModelInfo[] {
  return anthropicCatalog().models
}

/** For useSyncExternalStore: called after every change. */
export function subscribeAnthropicCatalog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Asks Anthropic which models the key can use, keeps the newest of each
 * family, and stores the result. Throws, leaving the catalog as it was, when
 * the request fails, nothing usable is listed, or storage refuses the write.
 */
export async function refreshAnthropicCatalog(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Promise<AnthropicCatalog> {
  const models = newestPerFamily(await listAnthropicModels(apiKey, fetchImpl))
  if (models.length === 0) {
    throw new Error('Anthropic listed no Claude model VoxNote can offer')
  }
  const next: AnthropicCatalog = { models, fetchedAt: now().toISOString() }
  try {
    localStorage.setItem(ANTHROPIC_CATALOG_KEY, JSON.stringify(next))
  } catch (err: unknown) {
    throw new Error(
      `The model list could not be saved: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  setCatalog(next)
  return next
}

/**
 * Back to the built-in list, and forgets the stored one: the fetched list
 * described one key, so it goes when that key is removed or replaced.
 */
export function resetAnthropicCatalog(): void {
  localStorage.removeItem(ANTHROPIC_CATALOG_KEY)
  if (current === BUILT_IN) return
  setCatalog(BUILT_IN)
}

function setCatalog(next: AnthropicCatalog) {
  current = next
  for (const listener of listeners) listener()
}

/** A stored catalog, or the built-in one when anything about it is off. */
export function normalizeCatalog(value: unknown): AnthropicCatalog {
  if (typeof value !== 'object' || value === null) return BUILT_IN
  const v = value as Record<string, unknown>
  if (
    typeof v.fetchedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(v.fetchedAt)
  ) {
    return BUILT_IN
  }
  if (!Array.isArray(v.models)) return BUILT_IN
  const models: TextModelInfo[] = []
  for (const m of v.models as unknown[]) {
    if (typeof m !== 'object' || m === null) return BUILT_IN
    const { id, label } = m as Record<string, unknown>
    if (typeof id !== 'string' || typeof label !== 'string') return BUILT_IN
    if (!/^claude-[a-z0-9-]+$/.test(id)) return BUILT_IN
    models.push({ id, label })
  }
  if (models.length === 0) return BUILT_IN
  return { models, fetchedAt: v.fetchedAt }
}

function loadCatalog(): AnthropicCatalog {
  try {
    const raw = localStorage.getItem(ANTHROPIC_CATALOG_KEY)
    return raw ? normalizeCatalog(JSON.parse(raw)) : BUILT_IN
  } catch {
    // Unreadable storage or corrupt JSON: the built-in list, and the user
    // can refresh again. Same rule as the provider settings.
    return BUILT_IN
  }
}
