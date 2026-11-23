/**
 * Turns the list of models an Anthropic key can use (GET /v1/models) into a
 * short menu: the newest model of each Claude family (Opus, Sonnet, Haiku,
 * Fable, Mythos, and any family Anthropic adds later), so a new release such
 * as Claude Fable 5.2 shows up without a new VoxNote release and older
 * versions stay out of the menu. Pure and framework-free.
 *
 * Model ids follow `claude-<family>-<major>[-<minor>][-<YYYYMMDD>]`, as in
 * claude-fable-5-2, claude-sonnet-5 or claude-opus-4-20250514 (Anthropic's
 * models overview, read 2026-11-23). Ids in the older
 * `claude-<major>-<minor>-<family>` shape and ids with any other suffix
 * (previews) are left out: none is the newest of its family.
 */

/** One entry of the Models API list, trimmed to what the menu needs. */
export interface ListedModel {
  id: string
  /** e.g. "Claude Fable 5.2". */
  displayName?: string
  /** RFC 3339 release time, used only to break a version tie. */
  createdAt?: string
}

/** One menu entry; structurally a TextModelInfo. */
export interface ModelChoice {
  id: string
  label: string
}

export interface ClaudeModelVersion {
  family: string
  major: number
  minor: number
  /** The YYYYMMDD snapshot suffix, or 0 without one. */
  snapshot: number
}

/** Families in menu order; families not named here follow, by name. */
export const FAMILY_ORDER: readonly string[] = [
  'opus',
  'sonnet',
  'haiku',
  'fable',
  'mythos',
]

const MODEL_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-(\d{8}))?$/

export function parseClaudeModelId(id: string): ClaudeModelVersion | null {
  const match = MODEL_ID.exec(id)
  if (!match) return null
  return {
    family: match[1],
    major: Number(match[2]),
    minor: match[3] === undefined ? 0 : Number(match[3]),
    snapshot: match[4] === undefined ? 0 : Number(match[4]),
  }
}

/** The family of a model id, e.g. "fable" for claude-fable-5-1. */
export function familyOf(id: string): string | null {
  return parseClaudeModelId(id)?.family ?? null
}

/** Positive when `a` is the newer version of the same family. */
function compareVersions(a: ClaudeModelVersion, b: ClaudeModelVersion) {
  return a.major - b.major || a.minor - b.minor || a.snapshot - b.snapshot
}

function familyRank(family: string): number {
  const i = FAMILY_ORDER.indexOf(family)
  return i === -1 ? FAMILY_ORDER.length : i
}

/**
 * The newest model of each family, in FAMILY_ORDER. A version tie (the same
 * id listed twice, say) goes to the later `createdAt`.
 */
export function newestPerFamily(models: readonly ListedModel[]): ModelChoice[] {
  const best = new Map<
    string,
    { model: ListedModel; version: ClaudeModelVersion }
  >()
  for (const model of models) {
    const version = parseClaudeModelId(model.id)
    if (!version) continue
    const current = best.get(version.family)
    const order = current ? compareVersions(version, current.version) : 1
    const newer =
      order > 0 ||
      (order === 0 &&
        (model.createdAt ?? '') > (current?.model.createdAt ?? ''))
    if (newer) best.set(version.family, { model, version })
  }
  return [...best.values()]
    .sort(
      (a, b) =>
        familyRank(a.version.family) - familyRank(b.version.family) ||
        a.version.family.localeCompare(b.version.family),
    )
    .map(({ model }) => ({ id: model.id, label: labelOf(model) }))
}

function labelOf(model: ListedModel): string {
  const name = model.displayName?.trim()
  return name ? `${name} (${model.id})` : model.id
}

/**
 * The menu entry a saved model id maps to: the same id when it is listed,
 * otherwise the listed model of the same family, so a saved claude-fable-5-1
 * moves to claude-fable-5-2 once that is the newest Fable. Undefined when
 * the family is not listed at all.
 */
export function choiceFor(
  savedId: string,
  choices: readonly ModelChoice[],
): string | undefined {
  if (choices.some((c) => c.id === savedId)) return savedId
  const family = familyOf(savedId)
  if (family === null) return undefined
  return choices.find((c) => familyOf(c.id) === family)?.id
}
