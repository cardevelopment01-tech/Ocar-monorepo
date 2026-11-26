import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { useRouter } from 'expo-router'
import { PermissionSetup, type PermissionRowModel } from '@ocar/mobile-shared'
import { readPermissionRows, requestPermission, snoozeSetup } from '@/features/permissions/permissionSetup'

// Shown after sign-in while notifications or location is off, so a driver never has to hunt for the setting that decides whether
// they get a ride request. "Not now" hides it for a day.
export default function PermissionsScreen() {
  const router = useRouter()
  const [rows, setRows] = useState<PermissionRowModel[] | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const refresh = useCallback(async () => setRows(await readPermissionRows()), [])
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
      subtitle="Two quick things so ride requests always reach you."
      rows={rows}
      busyKey={busyKey}
      onAllow={(k) => void onAllow(k)}
      onContinue={() => router.replace('/')}
      onSkip={() => { void snoozeSetup().then(() => router.replace('/')) }}
    />
  )
}
