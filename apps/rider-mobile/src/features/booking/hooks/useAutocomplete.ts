import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { mapBookingErrorCode, type GeoAutocompleteResult } from '@ocar/mobile-shared'
import { fetchAutocomplete } from '../api'
import { useDebouncedValue } from './useDebouncedValue'

export type AutocompleteState = {
  results: GeoAutocompleteResult[]
  loading: boolean
  error: string | null
  retry: () => void
}

// Backend requires a 2-char minimum (geo.controller.ts's getAutocomplete
// short-circuits below that), so don't even fire the request until then.
const MIN_QUERY_LENGTH = 2

export function useAutocomplete(query: string, bias: { lat?: number; lng?: number }): AutocompleteState {
  const debouncedQuery = useDebouncedValue(query)
  const [results, setResults] = useState<GeoAutocompleteResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const trimmed = debouncedQuery.trim()
    abortRef.current?.abort()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    fetchAutocomplete(trimmed, bias.lat, bias.lng, { signal: controller.signal })
      .then((res) => {
        setResults(res)
        setLoading(false)
      })
      .catch((err) => {
        if (axios.isCancel(err)) return
        const code = axios.isAxiosError(err) ? (err.response?.data as { code?: string } | undefined)?.code : undefined
        setError(code ? mapBookingErrorCode(code) : "Couldn't search. Please try again.")
        setLoading(false)
      })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bias.lat/lng churn shouldn't refire mid-debounce
  }, [debouncedQuery, retryTick])

  return { results, loading, error, retry: () => setRetryTick((t) => t + 1) }
}
