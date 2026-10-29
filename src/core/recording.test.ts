import { describe, expect, it } from 'vitest'
import { formatDuration, pickRecordingMimeType } from './recording'

describe('pickRecordingMimeType', () => {
  it('prefers WebM/Opus when available', () => {
    expect(pickRecordingMimeType(() => true)).toBe('audio/webm;codecs=opus')
  })

  it('falls back to MP4 on a Safari-like browser', () => {
    expect(pickRecordingMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4')
  })

  it('throws when nothing is supported', () => {
    expect(() => pickRecordingMimeType(() => false)).toThrow(
      /cannot record audio/,
    )
  })
})

describe('formatDuration', () => {
  it('formats m:ss and floors partial seconds', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(7999)).toBe('0:07')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(750_000)).toBe('12:30')
    expect(formatDuration(-5)).toBe('0:00')
  })
})
