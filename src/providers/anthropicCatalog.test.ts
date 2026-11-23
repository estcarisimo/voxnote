import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANTHROPIC_TEXT_MODELS, ANTHROPIC_VERSION } from './anthropic'
import {
  ANTHROPIC_CATALOG_KEY,
  anthropicCatalog,
  anthropicModels,
  normalizeCatalog,
  refreshAnthropicCatalog,
  resetAnthropicCatalog,
  subscribeAnthropicCatalog,
} from './anthropicCatalog'
import { normalizeTextSettings } from './registry'

type FetchMock = typeof fetch & ReturnType<typeof vi.fn>

function modelsReplying(...pages: unknown[]): FetchMock {
  const queue = [...pages]
  return vi.fn(async () => {
    const body = queue.shift()
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as FetchMock
}

const page = {
  data: [
    {
      type: 'model',
      id: 'claude-fable-5-2',
      display_name: 'Claude Fable 5.2',
      created_at: '2026-11-01T00:00:00Z',
    },
    { type: 'model', id: 'claude-fable-5-1', display_name: 'Claude Fable 5.1' },
    { type: 'model', id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' },
    { type: 'model', id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' },
  ],
  has_more: false,
  first_id: 'claude-fable-5-2',
  last_id: 'claude-haiku-5-5',
}

const now = () => new Date('2026-11-23T22:10:00Z')

beforeEach(() => {
  localStorage.clear()
  resetAnthropicCatalog()
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  resetAnthropicCatalog()
})

describe('Anthropic model catalog', () => {
  it('starts on the built-in list, which has Claude Fable 5.2 and not 5.1', () => {
    expect(anthropicCatalog()).toEqual({
      models: ANTHROPIC_TEXT_MODELS,
      fetchedAt: null,
    })
    const ids = anthropicModels().map((m) => m.id)
    expect(ids).toContain('claude-fable-5-2')
    expect(ids).not.toContain('claude-fable-5-1')
  })

  it('asks GET /v1/models with the key and the browser headers, and keeps the newest of each family', async () => {
    const fetchImpl = modelsReplying(page)
    const listener = vi.fn()
    const unsubscribe = subscribeAnthropicCatalog(listener)
    const catalog = await refreshAnthropicCatalog('sk-ant-test', fetchImpl, now)
    unsubscribe()

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(init.headers).toEqual({
      'x-api-key': 'sk-ant-test',
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    })
    expect(catalog).toEqual({
      fetchedAt: '2026-11-23T22:10:00.000Z',
      models: [
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (claude-opus-5-5)' },
        {
          id: 'claude-haiku-5-5',
          label: 'Claude Haiku 5.5 (claude-haiku-5-5)',
        },
        {
          id: 'claude-fable-5-2',
          label: 'Claude Fable 5.2 (claude-fable-5-2)',
        },
      ],
    })
    expect(anthropicCatalog()).toEqual(catalog)
    expect(listener).toHaveBeenCalledTimes(1)
    // Stored: ids and names only, never the key.
    const stored = localStorage.getItem(ANTHROPIC_CATALOG_KEY) ?? ''
    expect(JSON.parse(stored)).toEqual(catalog)
    expect(stored).not.toContain('sk-ant')
  })

  it('follows pages with after_id', async () => {
    const fetchImpl = modelsReplying(
      {
        data: [{ id: 'claude-fable-5-1' }],
        has_more: true,
        last_id: 'claude-fable-5-1',
      },
      { data: [{ id: 'claude-fable-5-2' }], has_more: false },
    )
    const catalog = await refreshAnthropicCatalog('sk-ant-test', fetchImpl, now)
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-fable-5-1',
    )
    expect(catalog.models.map((m) => m.id)).toEqual(['claude-fable-5-2'])
  })

  it('fails loudly, leaving the list as it was, on an error, an empty list or a broken page', async () => {
    const error = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'authentication_error',
              message: 'invalid x-api-key',
            },
          }),
          { status: 401 },
        ),
    ) as unknown as typeof fetch
    await expect(
      refreshAnthropicCatalog('sk-ant-bad', error, now),
    ).rejects.toThrow('Anthropic responded 401: invalid x-api-key')
    await expect(
      refreshAnthropicCatalog(
        'sk-ant-test',
        modelsReplying({
          data: [{ id: 'claude-mythos-preview' }],
          has_more: false,
        }),
        now,
      ),
    ).rejects.toThrow(/no Claude model/)
    await expect(
      refreshAnthropicCatalog(
        'sk-ant-test',
        modelsReplying({ models: [] }),
        now,
      ),
    ).rejects.toThrow(/no model list/)
    await expect(
      refreshAnthropicCatalog(
        'sk-ant-test',
        modelsReplying({ data: [], has_more: true }),
        now,
      ),
    ).rejects.toThrow(/no next page/)
    await expect(
      refreshAnthropicCatalog('  ', modelsReplying(page), now),
    ).rejects.toThrow(/needs an API key/)
    expect(anthropicCatalog().fetchedAt).toBeNull()
    expect(localStorage.getItem(ANTHROPIC_CATALOG_KEY)).toBeNull()
  })

  it('fails loudly when storage refuses the list', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    await expect(
      refreshAnthropicCatalog('sk-ant-test', modelsReplying(page), now),
    ).rejects.toThrow('The model list could not be saved: QuotaExceededError')
    expect(anthropicCatalog().fetchedAt).toBeNull()
  })

  it('reads a stored list back and rejects a damaged one', () => {
    const good = {
      fetchedAt: '2026-11-23T22:10:00.000Z',
      models: [{ id: 'claude-fable-5-2', label: 'Claude Fable 5.2' }],
    }
    expect(normalizeCatalog(good)).toEqual(good)
    for (const bad of [
      null,
      'x',
      { ...good, fetchedAt: 'yesterday' },
      { ...good, models: [] },
      { ...good, models: [{ id: 'gpt-5', label: 'GPT' }] },
      { ...good, models: [{ id: 'claude-fable-5-2' }] },
    ]) {
      expect(normalizeCatalog(bad).fetchedAt).toBeNull()
    }
  })

  it('moves a saved older Claude model to the newest of its family', async () => {
    // Built-in list: Fable 5.1 is gone, so a saved 5.1 becomes 5.2.
    expect(
      normalizeTextSettings({
        provider: 'anthropic',
        model: 'claude-fable-5-1',
      }),
    ).toEqual({ provider: 'anthropic', model: 'claude-fable-5-2' })
    // A family the list lacks falls back to the first listed model.
    await refreshAnthropicCatalog(
      'sk-ant-test',
      modelsReplying({ data: [{ id: 'claude-opus-5-5' }], has_more: false }),
      now,
    )
    expect(
      normalizeTextSettings({
        provider: 'anthropic',
        model: 'claude-fable-5-2',
      }),
    ).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' })
  })
})
