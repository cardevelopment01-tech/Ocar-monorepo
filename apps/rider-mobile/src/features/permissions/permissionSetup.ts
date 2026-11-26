import { useEffect, useState } from 'react'
import { Linking } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { readLocationStatus, readNotificationStatus, shouldShowSetup, type PermissionRowModel } from '@ocar/mobile-shared'
import { setupPushNotifications } from '@/services/notifications'

const SNOOZE_KEY = 'ocar_permission_setup_snoozed_at'

export async function readPermissionRows(): Promise<PermissionRowModel[]> {
  const [notifications, location] = await Promise.all([readNotificationStatus(), readLocationStatus()])
  return [
    { key: 'notifications', title: 'Notifications', reason: 'Your driver on the way, arrival and trip updates, even when Ocar is closed.', status: notifications, required: true, actionLabel: 'Allow' },
    { key: 'location', title: 'Location', reason: 'Finds your pickup point and the cabs near you.', status: location, required: true, actionLabel: 'Allow' },
  ]
}

/** One tap on a row: the system dialog while Android still shows it, the phone's settings once it will not. */
export async function requestPermission(key: string, rows: PermissionRowModel[]): Promise<void> {
  const row = rows.find((r) => r.key === key)
  if (!row || row.status === 'granted') return
  if (row.status === 'blocked') { await Linking.openSettings(); return }
  if (key === 'notifications') await setupPushNotifications({ prompt: true })
  else if (key === 'location') await Location.requestForegroundPermissionsAsync()
}

export async function snoozeSetup(): Promise<void> {
  await AsyncStorage.setItem(SNOOZE_KEY, String(Date.now())).catch(() => {})
}

/** 'checking' until the phone has answered; 'show' when a required permission is missing and "Not now" was not tapped today. */
export function usePermissionGate(enabled: boolean): 'checking' | 'show' | 'skip' {
  const [state, setState] = useState<'checking' | 'show' | 'skip'>('checking')
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      const [rows, raw] = await Promise.all([readPermissionRows(), AsyncStorage.getItem(SNOOZE_KEY).catch(() => null)])
      if (!cancelled) setState(shouldShowSetup(rows, raw ? Number(raw) : null, Date.now()) ? 'show' : 'skip')
    })().catch(() => { if (!cancelled) setState('skip') })
    return () => { cancelled = true }
  }, [enabled])
  return state
}
