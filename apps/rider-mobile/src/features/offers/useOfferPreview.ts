import { useCallback, useEffect, useRef, useState } from 'react'
import { previewOffer, type PreviewRequest } from './api'
import { LOADING_BOOK_LOCK_MS, type OfferChoice, type OfferPreview, type PreviewStatus } from './offerModel'
import { autoOfferParam } from './offerModel'

const DEBOUNCE_MS = 350

export type OfferPreviewState = {
  status: PreviewStatus
  preview: OfferPreview | null
  /** The code the rider typed (kept while it is being checked and after it is rejected). */
  typedCode: string
  choice: OfferChoice
  /** True only for the first second of a check, so a slow network never leaves Book disabled. */
  bookLocked: boolean
  applyCode: (code: string) => void
  removeCode: () => void
  /** Declines the automatic offer. */
  removeAuto: () => void
  chooseOffer: (offerId: string) => void
  retry: () => void
}

/**
 * Asks the server what offers apply to the ride on screen, again whenever the ride changes (category, route, payment,
 * schedule, a typed code or the rider's choice). The latest request wins: a slow earlier answer is dropped. A failed
 * check never blocks booking at full price; it only shows `status: 'error'`.
 *
 * `request` is null until there is a ride to price (no distance yet).
 */
export function useOfferPreview(request: Omit<PreviewRequest, 'code' | 'autoOffer'> | null): OfferPreviewState {
  const [typedCode, setTypedCode] = useState('')
  const [choice, setChoice] = useState<OfferChoice>({ kind: 'best' })
  const [status, setStatus] = useState<PreviewStatus>('idle')
  const [preview, setPreview] = useState<OfferPreview | null>(null)
  const [bookLocked, setBookLocked] = useState(false)
  const [nonce, setNonce] = useState(0)
  const generation = useRef(0)

  // The ride, as a stable key, so an unchanged ride does not refetch.
  const rideKey = request ? JSON.stringify(request) : ''

  useEffect(() => {
    if (!request) { setStatus('idle'); setPreview(null); return }
    const mine = ++generation.current
    const controller = new AbortController()
    setStatus('loading')
    setBookLocked(true)
    const unlock = setTimeout(() => { if (mine === generation.current) setBookLocked(false) }, LOADING_BOOK_LOCK_MS)
    const timer = setTimeout(async () => {
      const full: PreviewRequest = { ...request }
      if (typedCode) full.code = typedCode
      const auto = autoOfferParam(choice)
      if (auto !== undefined) full.autoOffer = auto
      try {
        const result = await previewOffer(full, controller.signal)
        if (mine !== generation.current) return
        setPreview(result)
        setStatus('ready')
      } catch {
        if (mine !== generation.current) return
        setStatus('error')
      } finally {
        if (mine === generation.current) setBookLocked(false)
      }
    }, DEBOUNCE_MS)
    return () => { clearTimeout(timer); clearTimeout(unlock); controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideKey, typedCode, choice, nonce])

  const applyCode = useCallback((code: string) => { setTypedCode(code.trim().toUpperCase().replace(/\s+/g, '')); setChoice({ kind: 'best' }) }, [])
  const removeCode = useCallback(() => { setTypedCode('') }, [])
  const removeAuto = useCallback(() => { setTypedCode(''); setChoice({ kind: 'none' }) }, [])
  const chooseOffer = useCallback((offerId: string) => { setTypedCode(''); setChoice({ kind: 'offer', offerId }) }, [])
  const retry = useCallback(() => setNonce((n) => n + 1), [])

  return { status, preview, typedCode, choice, bookLocked, applyCode, removeCode, removeAuto, chooseOffer, retry }
}
