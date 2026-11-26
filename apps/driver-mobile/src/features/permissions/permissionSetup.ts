import { useEffect, useState } from 'react'
import { Linking } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'
import { readBackgroundLocationGranted, readLocationStatus, readNotificationStatus, shouldShowSetup, type PermissionRowModel } from '@ocar/mobile-shared'
import { setupPushNotifications } from '@/services/notifications'

const SNOOZE_KEY = 'ocar_permission_setup_snoozed_at'

export async function readPermissionRows(): Promise<PermissionRowModel[]> {
  const [notifications, location, background] = await Promise.all([readNotificationStatus(), readLocationStatus(), readBackgroundLocationGranted()])
  // Android offers "all the time" only after "while using the app", so location is one row with two steps.
  const locationRow: PermissionRowModel = location !== 'granted'
    ? { key: 'location', title: 'Location', reason: 'Finds the rides near you and shows you on the map.', status: location, required: true, actionLabel: 'Allow' }
    : { key: 'location', title: 'Location all the time', reason: 'Keeps ride requests coming when your screen is off.', status: background ? 'granted' : 'ask', required: true, actionLabel: 'Allow' }
  return [
    { key: 'notifications', title: 'Notifications', reason: 'Ride requests and booking reminders reach you even when Ocar is closed.', status: notifications, required: true, actionLabel: 'Allow' },
    locationRow,
  ]
}

/** One tap on a row: the system dialog while Android still shows it, the phone's settings once it will not. */
export async function requestPermission(key: string, rows: PermissionRowModel[]): Promise<void> {
  const row = rows.find((r) => r.key === key)
  if (!row || row.status === 'granted') return
  if (row.status === 'blocked') { await Linking.openSettings(); return }
  if (key === 'notifications') { await setupPushNotifications({ prompt: true }); return }
  if (key === 'location') {
    const foreground = await Location.getForegroundPermissionsAsync()
    if (!foreground.granted) { await Location.requestForegroundPermissionsAsync(); return }
    await Location.requestBackgroundPermissionsAsync() // on Android 11+ this opens the phone's own page; coming back re-reads it
  }
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
