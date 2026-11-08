import { Pressable, Text } from 'react-native'
import { useRouter } from 'expo-router'
import { NotificationSettings, useNotificationPreferences } from '@ocar/mobile-shared'
import { api } from '@/services/api'
import { usePushEnableAction } from '@/features/notifications/usePushSetup'
import { useAlertPrefsStore } from '@/store/useAlertPrefsStore'
import { playTestAlert } from '@/features/ride-requests/testAlert'
import { overlay } from '@/services/overlay'

// Mirrors the Android channels created in services/notifications/index.ts.
const TOPICS = [
  { name: 'Ride requests', description: 'New ride offers sent to you while you are online.', icon: 'bell', tone: 'ride' as const },
  { name: 'Ride updates', description: 'Rides assigned to you, added stops, pickup changes and cancellations.', icon: 'navigation', tone: 'ride' as const },
  { name: 'Messages', description: 'Messages from your rider during a trip.', icon: 'message-circle', tone: 'ride' as const },
  { name: 'Announcements', description: 'Notices from Ocar, if you have not switched them off.', icon: 'volume-2', tone: 'promo' as const },
  { name: 'Account alerts', description: 'Document reviews and expiry, wallet balance, warnings and suspensions.', icon: 'shield', tone: 'account' as const },
]

export default function NotificationSettingsScreen() {
  const router = useRouter()
  const push = usePushEnableAction()
  const { prefs, set } = useNotificationPreferences(api)
  const voiceEnabled = useAlertPrefsStore((s) => s.voiceEnabled)
  const language = useAlertPrefsStore((s) => s.language)
  const setVoiceEnabled = useAlertPrefsStore((s) => s.setVoiceEnabled)
  const setLanguage = useAlertPrefsStore((s) => s.setLanguage)
  const floatingIconEnabled = useAlertPrefsStore((s) => s.floatingIconEnabled)
  const autoOpenEnabled = useAlertPrefsStore((s) => s.autoOpenEnabled)
  const setFloatingIconEnabled = useAlertPrefsStore((s) => s.setFloatingIconEnabled)
  const setAutoOpenEnabled = useAlertPrefsStore((s) => s.setAutoOpenEnabled)
  // Android builds that include the native overlay module only. Turning the icon on sends the driver to the system "display over
  // other apps" screen when the permission is missing; the icon itself only shows once it is granted.
  const overlaySwitches = overlay.available ? [
    {
      label: 'Floating Ocar icon',
      description: overlay.hasPermission()
        ? 'A small Ocar icon over other apps while you are online. Tap it to come back to Ocar.'
        : 'A small Ocar icon over other apps while you are online. Allow "Display over other apps" for Ocar when asked.',
      icon: 'circle', tone: 'ride' as const, value: floatingIconEnabled,
      onChange: (v: boolean) => { if (v && !overlay.hasPermission()) overlay.openPermissionSettings(); setFloatingIconEnabled(v) },
    },
    {
      label: 'Open Ocar for new requests',
      description: 'Brings Ocar to the front by itself when a request arrives and you are not moving fast. The loud notification still rings.',
      icon: 'external-link', tone: 'ride' as const, value: floatingIconEnabled && autoOpenEnabled,
      onChange: (v: boolean) => { if (v) { if (!floatingIconEnabled) setFloatingIconEnabled(true); if (!overlay.hasPermission()) overlay.openPermissionSettings() } setAutoOpenEnabled(v) },
    },
  ] : []
  // Always shown (they are on this phone, not on the server), ahead of the server-side category switches.
  const voiceSwitches = [
    { label: 'Read out new requests', description: 'Speaks the ride type, pickup, drop, distance and fare after the first ring.', icon: 'volume-2', tone: 'ride' as const, value: voiceEnabled, onChange: setVoiceEnabled },
    { label: 'Announce in Hindi', description: 'Off = English.', icon: 'globe', tone: 'ride' as const, value: language === 'hi', onChange: (v: boolean) => setLanguage(v ? 'hi' : 'en') },
  ]
  return (
    <NotificationSettings
      topics={TOPICS}
      switches={[
        ...voiceSwitches,
        ...overlaySwitches,
        ...(prefs ? [{ label: 'Announcements', description: 'Notices from Ocar', icon: 'volume-2', tone: 'promo' as const, value: prefs.announcements, onChange: (v: boolean) => set('announcements', v) }] : []),
      ]}
      footer={
        <Pressable onPress={() => { void playTestAlert() }} accessibilityRole="button" accessibilityLabel="Test the ride request ring and voice" style={{ minHeight: 48, borderRadius: 14, backgroundColor: '#0A9FB0', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 15 }}>Test ring and voice</Text>
        </Pressable>
      }
      permission={{ state: push.state, canAskAgain: push.canAskAgain }}
      onEnablePush={() => { void push.enable() }}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/home'))}
    />
  )
}
