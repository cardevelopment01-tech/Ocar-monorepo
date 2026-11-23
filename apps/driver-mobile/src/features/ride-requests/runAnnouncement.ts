import { estimateSpeechMs, segmentAt, segmentAtTime, type Segment, type SegmentKey } from './buildAnnouncement'

// The sequence of one ride request announcement, kept apart from React and the native modules so its timing can be tested.
//
//   0 s            the ring starts (the hook does that)
//   RING_BEFORE_SPEECH_MS   ask the voice to speak. The ring keeps playing while the engine wakes up.
//   voice starts   NOW the ring pauses (never before: a slow engine would otherwise leave a silent gap, and an engine that never
//                  starts would leave the driver without a ring for part of the 20 s window).
//   voice ends     the ring comes back. If the voice has not started within NO_START_GIVE_UP_MS, or runs past MAX_SPEECH_MS, the voice
//                  is stopped and the ring carries on: the ring must never be drowned by, or wait for, a voice that is not helping.

/** The ring is heard on its own this long before the voice is asked to speak. One ring of the client's tone is 1.0 s. */
export const RING_BEFORE_SPEECH_MS = 1000
/** No word within this long of asking: the engine is not going to speak in time, so keep the ring and drop the voice. */
export const NO_START_GIVE_UP_MS = 2000
/** The longest the voice may talk once it has started. The accept window is 20 s and the ring must come back with time to decide. */
export const MAX_SPEECH_MS = 10_000
/** No word positions this long after the voice starts: follow the clock instead (see segmentAtTime). */
export const FALLBACK_AFTER_MS = 1200

export type SpeakOptions = {
  language: string
  rate: number
  onStart: () => void
  onBoundary: (ev: { charIndex: number }) => void
  onDone: () => void
  onStopped: () => void
  onError: (e?: unknown) => void
}

/** The part of expo-speech this needs. */
export type SpeechLike = {
  speak: (text: string, options: SpeakOptions) => void
  stop: () => unknown
}

/** The part of the announcement store this needs: what the pop-up reads to follow along. */
export type AnnouncementSink = {
  set: (patch: { speaking?: boolean; segment?: SegmentKey | null }) => void
  reset: () => void
}

export type AnnouncementRun = {
  speech: SpeechLike
  /** Built when the voice is asked to speak, so a language decided in the meantime (no Hindi voice installed) is honoured. */
  build: () => { segments: Segment[]; locale: string; rate: number }
  ring: { pause: () => void; resume: () => void }
  announcement: AnnouncementSink
  /** Whether the request this announcement belongs to is still on screen. */
  isActive: () => boolean
}

/** Starts the sequence; the returned function ends it (the request was answered, or the voice settings changed). */
export function runAnnouncement(o: AnnouncementRun): () => void {
  let cancelled = false
  let requested = false
  let finished = false
  let ringPaused = false
  let sawBoundary = false
  let noStartTimer: ReturnType<typeof setTimeout> | undefined
  let maxTimer: ReturnType<typeof setTimeout> | undefined
  let fallback: ReturnType<typeof setTimeout> | undefined
  let timeline: ReturnType<typeof setInterval> | undefined

  const stopTimeline = () => {
    clearTimeout(fallback)
    clearInterval(timeline)
    timeline = undefined
  }
  const clearAll = () => {
    clearTimeout(startTimer)
    clearTimeout(noStartTimer)
    clearTimeout(maxTimer)
    stopTimeline()
  }
  const resumeRing = () => {
    if (!ringPaused) return
    ringPaused = false
    o.ring.resume()
  }
  const stopSpeech = () => {
    try {
      Promise.resolve(o.speech.stop()).catch(() => {})
    } catch {
      // the engine is gone: nothing to stop
    }
  }
  // Runs once however many of onDone / onStopped / onError / the timers fire, and never after the request ended.
  const finish = () => {
    if (cancelled || finished) return
    finished = true
    clearAll()
    o.announcement.reset()
    resumeRing()
  }
  const giveUp = () => {
    if (cancelled || finished) return
    stopSpeech()
    finish()
  }

  const startTimer = setTimeout(() => {
    if (cancelled) return
    const { segments, locale, rate } = o.build()
    const text = segments.map((s) => s.text).join(' ')
    requested = true
    noStartTimer = setTimeout(giveUp, NO_START_GIVE_UP_MS)
    try {
      o.speech.speak(text, {
        language: locale,
        rate,
        onStart: () => {
          if (cancelled || finished) return
          clearTimeout(noStartTimer)
          o.ring.pause()
          ringPaused = true
          o.announcement.set({ speaking: true, segment: null })
          maxTimer = setTimeout(giveUp, MAX_SPEECH_MS)
          // Some Android speech engines never report word positions. If none arrive shortly after the start, follow an even
          // pace over the estimated duration instead; real positions take over the moment they show up.
          const startedAt = Date.now()
          const total = estimateSpeechMs(text, rate)
          fallback = setTimeout(() => {
            if (cancelled || finished || sawBoundary || timeline) return
            timeline = setInterval(() => o.announcement.set({ segment: segmentAtTime(segments, Date.now() - startedAt, total) }), 250)
          }, FALLBACK_AFTER_MS)
        },
        onBoundary: (ev) => {
          if (cancelled || finished) return
          sawBoundary = true
          stopTimeline()
          o.announcement.set({ segment: segmentAt(segments, ev.charIndex) })
        },
        onDone: finish,
        onStopped: finish,
        onError: finish,
      })
    } catch {
      giveUp() // the engine refused outright: the ring was never paused, so there is nothing to bring back
    }
  }, RING_BEFORE_SPEECH_MS)

  return () => {
    cancelled = true
    clearAll()
    o.announcement.reset()
    if (requested) stopSpeech() // only what this run started: other speech is left alone
    // The voice was switched off or changed while the ring was paused for it: bring the ring back (unless the request ended).
    if (!finished && o.isActive()) resumeRing()
  }
}
