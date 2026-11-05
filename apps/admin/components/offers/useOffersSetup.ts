'use client'
import { useEffect, useState } from 'react'
import { offersApi, type OffersMeta } from '@/lib/offers-api'
import { vehicleCategoryApi } from '@/lib/vehicle-api'
import { cityApi } from '@/lib/city-api'
import { extractErrorMessage } from '@/lib/http-errors'
import type { Lookups } from './RuleBuilder'

/**
 * What the offer form needs before it can show anything: the rule/discount catalog (from the server) and the
 * category and city names the catalog cannot list. If the catalog fails to load the form stays unusable (fails
 * closed), because guessing the rules would let an admin build something the server then refuses.
 */
export function useOffersSetup() {
  const [meta, setMeta] = useState<OffersMeta | null>(null)
  const [lookups, setLookups] = useState<Lookups>({ categoryIds: [], cityIds: [] })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const m = await offersApi.meta()
        if (live) setMeta(m)
      } catch (err) {
        if (live) setError(extractErrorMessage(err, 'Could not load the offer options. Reload the page to try again.'))
      }
      // Names are a nicety for two pickers; their failure must not take the whole form down.
      const [cats, cities] = await Promise.all([vehicleCategoryApi.list().catch(() => []), cityApi.list().catch(() => [])])
      if (live) {
        setLookups({
          categoryIds: cats.map((c) => ({ value: String(c.id), label: c.display_name })),
          cityIds: cities.map((c) => ({ value: String(c.id), label: c.name })),
        })
        setLoading(false)
      }
    })()
    return () => { live = false }
  }, [])

  return { meta, lookups, error, loading }
}
