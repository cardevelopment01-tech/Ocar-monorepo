import { useCallback, useEffect, useState } from 'react'
import { AppState, Linking, StyleSheet, Text, View } from 'react-native'
import * as Notifications from 'expo-notifications'
import { Feather } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SlideModal } from '../ui/SlideModal'
import { Button } from '../ui/Button'
import { colors, fonts, radii, spacing, typography } from '../theme/tokens'

export type PushPermissionState = 'granted' | 'denied' | 'undetermined'

// OS-level notification permission, re-read whenever the app returns to the foreground (the
// user may have just flipped it in system settings). `canAskAgain` is false once Android will no
// longer show the system dialog, i.e. the only way left is the settings screen.
export function usePushPermission(): { state: PushPermissionState | null; canAskAgain: boolean; refresh: () => Promise<void> } {
  const [perm, setPerm] = useState<{ state: PushPermissionState; canAskAgain: boolean } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const p = await Notifications.getPermissionsAsync()
      setPerm({ state: p.granted ? 'granted' : p.canAskAgain && p.status !== 'denied' ? 'undetermined' : 'denied', canAskAgain: p.canAskAgain })
    } catch {
      // Unknown: treat as no information rather than showing a wrong banner.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void refresh() })
    return () => sub.remove()
  }, [refresh])

  return { state: perm?.state ?? null, canAskAgain: perm?.canAskAgain ?? true, refresh }
}

// Turning notifications on: the system dialog while Android still allows it, system settings once
// it doesn't. `setup` is the app's own registration function.
export function usePushEnable(setup: (opts: { prompt: boolean }) => Promise<void>) {
  const perm = usePushPermission()
  const [enabling, setEnabling] = useState(false)
  const { state, canAskAgain, refresh } = perm

  const enable = useCallback(async () => {
    if (state === 'denied' && !canAskAgain) {
      await Linking.openSettings()
      return
    }
    setEnabling(true)
    try {
      await setup({ prompt: true })
    } finally {
      setEnabling(false)
      await refresh()
    }
  }, [state, canAskAgain, setup, refresh])

  return { state, canAskAgain, enabling, enable }
}

const SNOOZE_MS = 3 * 86_400_000
const PRIMER_DELAY_MS = 1500

// Decides when to show the primer: once permission is undetermined, shortly after the host screen
// mounts, and not again for 3 days after "Not now".
export function usePushPrimer(
  push: { state: PushPermissionState | null; enabling: boolean; enable: () => Promise<void> },
  snooze: { get: () => Promise<number | null>; set: (ts: number) => Promise<void> },
) {
  const [visible, setVisible] = useState(false)
  const { state, enable } = push
  const { get, set } = snooze

  useEffect(() => {
    if (state !== 'undetermined') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    void get().then((last) => {
      if (cancelled || (last !== null && Date.now() - last < SNOOZE_MS)) return
      timer = setTimeout(() => { if (!cancelled) setVisible(true) }, PRIMER_DELAY_MS)
    }).catch(() => {})
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [state, get])

  const onLater = useCallback(() => {
    setVisible(false)
    void set(Date.now()).catch(() => {})
  }, [set])

  const onEnable = useCallback(async () => {
    await enable()
    setVisible(false)
  }, [enable])

  return { visible, enabling: push.enabling, onEnable, onLater }
}

type PrimerProps = {
  visible: boolean
  title: string
  message: string
  bullets: string[]
  enabling?: boolean
  onEnable: () => void
  onLater: () => void
}

// The "why" shown before Android's own one-shot permission dialog. Asking cold burns the user's
// only (or one of two) chances, so we explain first and only then trigger the system prompt.
export function PushPrimerSheet({ visible, title, message, bullets, enabling = false, onEnable, onLater }: PrimerProps) {
  const insets = useSafeAreaInsets()
  return (
    <SlideModal visible={visible} onRequestClose={onLater}>
      <View style={styles.wrap}>
        <View style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]}>
          <View style={styles.handle} />
          <View style={styles.iconWrap}>
            <Feather name="bell" size={22} color={colors.primary} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.bullets}>
            {bullets.map((b) => (
              <View key={b} style={styles.bulletRow}>
                <Feather name="check" size={16} color={colors.primary} />
                <Text style={styles.bulletText}>{b}</Text>
              </View>
            ))}
          </View>
          <Button label="Turn on notifications" onPress={onEnable} loading={enabling} />
          <Button label="Not now" variant="ghost" onPress={onLater} disabled={enabling} />
        </View>
      </View>
    </SlideModal>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  handle: { width: spacing.xl, height: spacing.xs, borderRadius: radii.full, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.sm },
  iconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold, marginTop: spacing.xs },
  message: { ...typography.body, lineHeight: 22, color: colors.ink600 },
  bullets: { gap: spacing.xs, marginVertical: spacing.sm },
  bulletRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bulletText: { ...typography.body, lineHeight: 22, color: colors.ink900, flex: 1 },
})
