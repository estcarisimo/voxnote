import { describe, expect, it } from 'vitest'
import {
  choiceFor,
  familyOf,
  newestPerFamily,
  parseClaudeModelId,
} from './claudeModels'

describe('parseClaudeModelId', () => {
  it('reads family, version and snapshot from current and dated ids', () => {
    expect(parseClaudeModelId('claude-fable-5-2')).toEqual({
      family: 'fable',
      major: 5,
      minor: 2,
      snapshot: 0,
    })
    expect(parseClaudeModelId('claude-sonnet-5')).toEqual({
      family: 'sonnet',
      major: 5,
      minor: 0,
      snapshot: 0,
    })
    expect(parseClaudeModelId('claude-opus-4-20250514')).toEqual({
      family: 'opus',
      major: 4,
      minor: 0,
      snapshot: 20250514,
    })
    expect(parseClaudeModelId('claude-haiku-4-5-20251001')).toEqual({
      family: 'haiku',
      major: 4,
      minor: 5,
      snapshot: 20251001,
    })
  })

  it('leaves out old-style, preview and foreign ids', () => {
    expect(parseClaudeModelId('claude-3-5-sonnet-20241022')).toBeNull()
    expect(parseClaudeModelId('claude-mythos-preview')).toBeNull()
    expect(parseClaudeModelId('gpt-6.1-terra')).toBeNull()
    expect(parseClaudeModelId('')).toBeNull()
  })
})

describe('newestPerFamily', () => {
  const listed = [
    { id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1' },
    { id: 'claude-fable-5-2', displayName: 'Claude Fable 5.2' },
    { id: 'claude-fable-5', displayName: 'Claude Fable 5' },
    { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5' },
    { id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
    { id: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5' },
    { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8' },
    { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5' },
    { id: 'claude-opus-4-20250514', displayName: 'Claude Opus 4' },
    { id: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet' },
  ]

  it('keeps the newest of each family, in menu order, labeled with name and id', () => {
    expect(newestPerFamily(listed)).toEqual([
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (claude-opus-5-5)' },
      {
        id: 'claude-sonnet-5-5',
        label: 'Claude Sonnet 5.5 (claude-sonnet-5-5)',
      },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (claude-haiku-5-5)' },
      { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 (claude-fable-5-2)' },
    ])
  })

  it('does not depend on the order of the list', () => {
    expect(newestPerFamily([...listed].reverse())).toEqual(
      newestPerFamily(listed),
    )
  })

  it('puts a family it does not know after the known ones, and labels a nameless model by id', () => {
    expect(
      newestPerFamily([
        { id: 'claude-zephyr-1' },
        { id: 'claude-mythos-5-2', displayName: 'Claude Mythos 5.2' },
        { id: 'claude-aria-2-1', displayName: '  ' },
        { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5' },
      ]).map((c) => c.label),
    ).toEqual([
      'Claude Opus 5.5 (claude-opus-5-5)',
      'Claude Mythos 5.2 (claude-mythos-5-2)',
      'claude-aria-2-1',
      'claude-zephyr-1',
    ])
  })

  it('breaks a version tie by release time', () => {
    expect(
      newestPerFamily([
        {
          id: 'claude-opus-5-5',
          displayName: 'Old',
          createdAt: '2026-09-01T00:00:00Z',
        },
        {
          id: 'claude-opus-5-5',
          displayName: 'New',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ]),
    ).toEqual([{ id: 'claude-opus-5-5', label: 'New (claude-opus-5-5)' }])
  })

  it('returns nothing for a list with no Claude model it can read', () => {
    expect(newestPerFamily([{ id: 'claude-mythos-preview' }])).toEqual([])
  })
})

describe('choiceFor', () => {
  const menu = newestPerFamily([
    { id: 'claude-opus-5-5' },
    { id: 'claude-fable-5-2' },
  ])

  it('keeps a listed model', () => {
    expect(choiceFor('claude-opus-5-5', menu)).toBe('claude-opus-5-5')
  })

  it('moves an unlisted model to the listed model of its family', () => {
    expect(choiceFor('claude-fable-5-1', menu)).toBe('claude-fable-5-2')
    expect(choiceFor('claude-opus-4-8', menu)).toBe('claude-opus-5-5')
  })

  it('gives up on a family the menu lacks or an id it cannot read', () => {
    expect(choiceFor('claude-haiku-5-5', menu)).toBeUndefined()
    expect(choiceFor('gpt-6.1-terra', menu)).toBeUndefined()
    expect(choiceFor('', menu)).toBeUndefined()
  })

  it('reads the family of an id', () => {
    expect(familyOf('claude-fable-5-1')).toBe('fable')
    expect(familyOf('whisper-1')).toBeNull()
  })
})
