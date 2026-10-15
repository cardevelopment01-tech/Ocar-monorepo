import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuthStore } from '@/store/useAuthStore'
import { refreshDriverProfile } from './refreshDriver'
import { restrictionOf } from './accountStanding'

const MIN_GAP_MS = 20_000

// Keeps the saved account status honest while the app is open: re-read it whenever the app comes back to the
// foreground, and leave for the launch router the moment the account becomes suspended or banned.
export function useStandingSync() {
  const router = useRouter()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const status = useAuthStore((s) => s.driver?.status)
  const lastRun = useRef(0)
  const seen = useRef<string | undefined>(status)

  useEffect(() => {
    if (!isAuthenticated) return
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || Date.now() - lastRun.current < MIN_GAP_MS) return
      lastRun.current = Date.now()
      void refreshDriverProfile()
    })
    return () => sub.remove()
  }, [isAuthenticated])

  useEffect(() => {
    const before = seen.current
    seen.current = status
    // Only a change INTO a restriction while the app is open; a cold start is routed by app/index.tsx.
    if (before !== undefined && before !== status && restrictionOf(status)) router.replace('/')
  }, [status, router])
}
