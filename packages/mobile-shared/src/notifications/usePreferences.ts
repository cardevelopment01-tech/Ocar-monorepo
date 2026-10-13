import { useCallback, useEffect, useState } from 'react'
import type { AxiosInstance } from 'axios'

export type OptionalCategory = 'announcements' | 'offers'
type Prefs = Record<OptionalCategory, boolean>

// The two categories a user may switch off. Everything else is not stored and cannot be disabled.
export function useNotificationPreferences(api: AxiosInstance) {
  const [prefs, setPrefs] = useState<Prefs | null>(null)

  useEffect(() => {
    let cancelled = false
    api.get<Prefs>('/api/v1/notifications/preferences')
      .then((res) => { if (!cancelled) setPrefs(res.data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [api])

  const set = useCallback((category: OptionalCategory, enabled: boolean) => {
    setPrefs((p) => (p ? { ...p, [category]: enabled } : p))
    api.put('/api/v1/notifications/preferences', { category, enabled }).catch(() => {
      setPrefs((p) => (p ? { ...p, [category]: !enabled } : p))
    })
  }, [api])

  return { prefs, set }
}
