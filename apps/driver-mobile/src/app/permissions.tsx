import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { PermissionSetup, type PermissionRowModel } from '@ocar/mobile-shared'
import { readPermissionRows, requestPermission, snoozeSetup } from '@/features/permissions/permissionSetup'

// Shown after sign-in while notifications or location is off, so a driver never has to hunt for the setting that decides whether
// they get a ride request. "Not now" hides it for a day.
export default function PermissionsScreen() {
  const router = useRouter()
  // A driver still in onboarding is sent here for notifications only (?only=notifications).
  const only = useLocalSearchParams<{ only?: string }>().only === 'notifications' ? 'notifications' : undefined
  const [rows, setRows] = useState<PermissionRowModel[] | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const refresh = useCallback(async () => setRows(await readPermissionRows(only)), [only])
  useEffect(() => {
    void refresh()
    // Back from the phone's settings: read it again.
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refresh() })
    return () => sub.remove()
  }, [refresh])

  const onAllow = useCallback(async (key: string) => {
    if (!rows) return
    setBusyKey(key)
    try { await requestPermission(key, rows) } finally { setBusyKey(null); await refresh() }
  }, [rows, refresh])

  return (
    <PermissionSetup
      title="Set up Ocar"
      subtitle={only ? "One quick thing so we can keep you updated on your application." : "Two quick things so ride requests always reach you."}
      rows={rows}
      busyKey={busyKey}
      onAllow={(k) => void onAllow(k)}
      onContinue={() => router.replace('/')}
      onSkip={() => { void snoozeSetup().then(() => router.replace('/')) }}
    />
  )
}
