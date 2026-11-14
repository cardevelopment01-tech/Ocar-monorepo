import { describe, expect, it, vi } from 'vitest'
import { warmUpSpeech } from './speech'

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
