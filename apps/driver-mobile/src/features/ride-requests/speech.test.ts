import { describe, expect, it, vi } from 'vitest'
import { hasVoiceFor, warmUpSpeech } from './speech'

describe('warmUpSpeech', () => {
  it('asks the speech engine for its voices so it starts before the first request', () => {
    const getAvailableVoicesAsync = vi.fn().mockResolvedValue([])
    warmUpSpeech({ getAvailableVoicesAsync })
    expect(getAvailableVoicesAsync).toHaveBeenCalledTimes(1)
  })

  it('never throws when the engine refuses, throws, or is missing', async () => {
    expect(() => warmUpSpeech({ getAvailableVoicesAsync: vi.fn().mockRejectedValue(new Error('no engine')) })).not.toThrow()
    expect(() => warmUpSpeech({ getAvailableVoicesAsync: () => { throw new Error('boom') } })).not.toThrow()
    expect(() => warmUpSpeech(null)).not.toThrow()
    await Promise.resolve()
  })
})

describe('hasVoiceFor', () => {
  const voices = (...langs: string[]) => vi.fn().mockResolvedValue(langs.map((language, i) => ({ identifier: `v${i}`, name: `v${i}`, quality: 'Default', language })))

  it('is true when the phone has a voice for the language, however the engine writes it', async () => {
    expect(await hasVoiceFor('hi', { getAvailableVoicesAsync: voices('en-IN', 'hi-IN') })).toBe(true)
    expect(await hasVoiceFor('hi', { getAvailableVoicesAsync: voices('hi_IN') })).toBe(true)
    expect(await hasVoiceFor('en', { getAvailableVoicesAsync: voices('en-US') })).toBe(true)
  })

  it('is false when voices are installed but none speaks the language (the Hindi text would be read by an English voice)', async () => {
    expect(await hasVoiceFor('hi', { getAvailableVoicesAsync: voices('en-IN', 'en-US') })).toBe(false)
  })

  it('never downgrades on a guess: no module, an empty list, or an engine that fails all count as yes', async () => {
    expect(await hasVoiceFor('hi', null)).toBe(true)
    expect(await hasVoiceFor('hi', { getAvailableVoicesAsync: vi.fn().mockResolvedValue([]) })).toBe(true)
    expect(await hasVoiceFor('hi', { getAvailableVoicesAsync: vi.fn().mockRejectedValue(new Error('no engine')) })).toBe(true)
    expect(await hasVoiceFor('hi', { getAvailableVoicesAsync: () => { throw new Error('boom') } })).toBe(true)
  })
})
