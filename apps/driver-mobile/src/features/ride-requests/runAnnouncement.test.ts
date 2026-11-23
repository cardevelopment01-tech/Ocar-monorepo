import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAnnouncementSegments } from './buildAnnouncement'
import { FALLBACK_AFTER_MS, MAX_SPEECH_MS, NO_START_GIVE_UP_MS, RING_BEFORE_SPEECH_MS, runAnnouncement, type SpeakOptions } from './runAnnouncement'
import type { RideRequestPayload } from './types'

// Value: protects=the ring is never silenced by a voice that is slow, missing or too long, and never plays over the voice;
// fails_when=the ring is paused before the voice has started, is not brought back when the voice ends, fails or runs long, or the
// voice is not stopped when it gives up; why_new=the ring used to pause before the engine had started and came back over a long
// announcement (9 s timer against 9-17 s of speech); seam=fake timers and a fake speech engine, no device; no_claim=how it sounds.
const request: RideRequestPayload = {
  rideId: '1', pickup: 'Saheed Nagar, Bhubaneswar', drop: 'Badambadi, Cuttack', pickupLat: 0, pickupLng: 0, distanceToPickup: 1200,
  estimatedFare: 450, rideType: 'one_way', isReturnCab: false, expiresAt: '', timeoutSeconds: 20, paymentChannel: 'cash', tripKm: 28,
}

function setup(opts: { speakThrows?: boolean; active?: () => boolean } = {}) {
  const calls: string[] = []
  let spoken: SpeakOptions | undefined
  let spokenText = ''
  const speech = {
    speak: vi.fn((text: string, o: SpeakOptions) => {
      if (opts.speakThrows) throw new Error('no engine')
      calls.push('speak')
      spokenText = text
      spoken = o
    }),
    stop: vi.fn(() => { calls.push('stop') }),
  }
  const ring = { pause: vi.fn(() => { calls.push('pause') }), resume: vi.fn(() => { calls.push('resume') }) }
  const announcement = { set: vi.fn(), reset: vi.fn() }
  const build = vi.fn(() => ({ segments: buildAnnouncementSegments(request), locale: 'en-IN', rate: 1.05 }))
  const cleanup = runAnnouncement({ speech, build, ring, announcement, isActive: opts.active ?? (() => true) })
  return { speech, ring, announcement, build, cleanup, calls, options: () => spoken!, text: () => spokenText }
}

describe('runAnnouncement', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('asks the voice to speak after the first ring, with the ring still playing, and pauses it only when the voice starts', () => {
    const t = setup()
    vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS - 1)
    expect(t.speech.speak).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(t.speech.speak).toHaveBeenCalledTimes(1)
    expect(t.text()).toMatch(/^New ride request\. Fare 450 rupees, cash\./)
    expect(t.ring.pause).not.toHaveBeenCalled() // the engine is still waking up: the ring keeps going
    t.options().onStart()
    expect(t.ring.pause).toHaveBeenCalledTimes(1)
    expect(t.announcement.set).toHaveBeenCalledWith({ speaking: true, segment: null })
  })

  it('a slow engine does not leave a silent gap: the ring plays until the first word', () => {
    const t = setup()
    vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS + 1500) // engine takes 1.5 s, under the give-up limit
    expect(t.ring.pause).not.toHaveBeenCalled()
    t.options().onStart()
    expect(t.ring.pause).toHaveBeenCalledTimes(1)
    t.options().onDone()
    expect(t.ring.resume).toHaveBeenCalledTimes(1)
  })

  it('brings the ring back exactly once when the voice ends, however many end callbacks fire', () => {
    const t = setup()
    vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS)
    t.options().onStart()
    t.options().onDone()
    t.options().onStopped()
    t.options().onError()
    expect(t.ring.resume).toHaveBeenCalledTimes(1)
    expect(t.announcement.reset).toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(t.ring.resume).toHaveBeenCalledTimes(1) // no timer fires a second time
    expect(t.speech.stop).not.toHaveBeenCalled() // it ended by itself: nothing to stop
  })

  it('a voice that never starts is dropped: the ring is never paused, and the voice is stopped', () => {
    const t = setup()
    vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS + NO_START_GIVE_UP_MS)
    expect(t.speech.stop).toHaveBeenCalledTimes(1)
    expect(t.ring.pause).not.toHaveBeenCalled()
    expect(t.ring.resume).not.toHaveBeenCalled() // it never stopped, so there is nothing to bring back
    t.options().onStart() // a late word from the abandoned engine is ignored
    expect(t.ring.pause).not.toHaveBeenCalled()
    expect(t.announcement.reset).toHaveBeenCalled()
  })

  it('a voice that runs too long is stopped and the ring comes back, not left to talk over it', () => {
    const t = setup()
    vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS)
    t.options().onStart()
    vi.advanceTimersByTime(MAX_SPEECH_MS - 1)
    expect(t.ring.resume).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(t.speech.stop).toHaveBeenCalledTimes(1)
    expect(t.ring.resume).toHaveBeenCalledTimes(1)
    expect(t.calls.indexOf('stop')).toBeLessThan(t.calls.indexOf('resume')) // stop the voice first, then ring
  })

  it('an engine error after the start brings the ring back; one before the start leaves it alone', () => {
    const a = setup()
    vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS)
    a.options().onStart()
    a.options().onError(new Error('tts'))
    expect(a.ring.resume).toHaveBeenCalledTimes(1)

    const b = setup()
    vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS)
    b.options().onError(new Error('no language'))
    expect(b.ring.pause).not.toHaveBeenCalled()
    expect(b.ring.resume).not.toHaveBeenCalled()
  })

  it('an engine that throws on speak() is dropped without touching the ring', () => {
    const t = setup({ speakThrows: true })
    expect(() => vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS)).not.toThrow()
    expect(t.ring.pause).not.toHaveBeenCalled()
    expect(t.ring.resume).not.toHaveBeenCalled()
  })

  it('builds the sentence when it speaks, not before, so a language chosen in the meantime is used', () => {
    const t = setup()
    expect(t.build).not.toHaveBeenCalled()
    vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS)
    expect(t.build).toHaveBeenCalledTimes(1)
    expect(t.options().language).toBe('en-IN')
    expect(t.options().rate).toBe(1.05)
  })

  it('ending it before the voice is asked to speak speaks nothing and stops nothing', () => {
    const t = setup()
    vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS - 100)
    t.cleanup()
    vi.advanceTimersByTime(60_000)
    expect(t.speech.speak).not.toHaveBeenCalled()
    expect(t.speech.stop).not.toHaveBeenCalled()
  })

  it('ending it while the voice is talking stops the voice, and brings the ring back only if the request is still on screen', () => {
    const live = setup({ active: () => true })
    vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS)
    live.options().onStart()
    live.cleanup() // e.g. the driver switched the voice off mid-sentence
    expect(live.speech.stop).toHaveBeenCalledTimes(1)
    expect(live.ring.resume).toHaveBeenCalledTimes(1)

    const answered = setup({ active: () => false })
    vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS)
    answered.options().onStart()
    answered.cleanup() // the driver accepted: the ring is ending anyway
    expect(answered.speech.stop).toHaveBeenCalledTimes(1)
    expect(answered.ring.resume).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(answered.ring.resume).not.toHaveBeenCalled()
  })

  it('follows the spoken words when the engine reports them, and the clock when it does not', () => {
    const withWords = setup()
    vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS)
    withWords.options().onStart()
    withWords.options().onBoundary({ charIndex: 0 })
    expect(withWords.announcement.set).toHaveBeenCalledWith({ segment: 'intro' })
    vi.advanceTimersByTime(FALLBACK_AFTER_MS + 1000)
    const wordsOnlyCalls = withWords.announcement.set.mock.calls.filter(([p]) => 'segment' in p && p.segment !== null).length
    expect(wordsOnlyCalls).toBe(1) // the clock never took over once words were arriving

    const silent = setup()
    vi.advanceTimersByTime(RING_BEFORE_SPEECH_MS)
    silent.options().onStart()
    vi.advanceTimersByTime(FALLBACK_AFTER_MS + 2000)
    const followed = silent.announcement.set.mock.calls.filter(([p]) => 'segment' in p && p.segment !== null)
    expect(followed.length).toBeGreaterThan(0)
  })
})
