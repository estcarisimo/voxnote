import { describe, expect, it } from 'vitest'
import { excerpt, openAiStyleError, redact, uploadFileName } from './stt-http'

describe('stt-http helpers', () => {
  it('redacts the sent key anywhere, and OpenAI-shaped secrets', () => {
    expect(redact('key abcd1234 and again abcd1234', 'abcd1234')).toBe(
      'key [redacted key] and again [redacted key]',
    )
    expect(redact('Incorrect key sk-abc123XYZ', 'sk-abc123XYZ')).toBe(
      'Incorrect key sk-…',
    )
  })

  it('redacts before cutting, so a key on the cut does not leak in part', () => {
    const key = 'K'.repeat(40)
    const text = `${'x'.repeat(190)}${key}`
    expect(excerpt(text, key)).not.toContain('KKKK')
  })

  it('reads OpenAI-shaped error bodies', () => {
    expect(openAiStyleError('{"error":{"message":"bad k1234"}}', 'k1234')).toBe(
      'bad [redacted key]',
    )
    expect(openAiStyleError('', 'k')).toBe('no response body')
  })

  it('names uploads by type for WebM and MP4', () => {
    expect(uploadFileName('audio/webm;codecs=opus', 'X')).toBe('recording.webm')
    expect(uploadFileName('audio/mp4', 'X')).toBe('recording.mp4')
    expect(() => uploadFileName('audio/x-unknown', 'X')).toThrow(
      /X does not accept/,
    )
  })
})
