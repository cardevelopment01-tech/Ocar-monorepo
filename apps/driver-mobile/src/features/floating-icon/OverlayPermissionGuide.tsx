import { useEffect, useRef, useState } from 'react'
import { AppState, StyleSheet, Switch, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { Button, colors, fonts, radii, spacing, Text } from '@ocar/mobile-shared'
import { BottomSheet } from '@/features/go-online/components/BottomSheet'
import { overlay } from '@/services/overlay'
import { useOverlayGuideStore } from '@/store/useOverlayGuideStore'

const STEPS = [
  'Find Ocar in the list',
  'Turn the switch on',
  'Press back to return here',
]

const DONE_MS = 1400

// Android will not let an app grant itself "Display over other apps", and some phones (Realme, Oppo, Xiaomi) open the whole app list
// instead of Ocar's own page. So the driver gets the three steps and a picture of the toggle first, then the system screen. When they
// come back with the permission on, the sheet confirms and closes by itself.
export function OverlayPermissionGuide() {
  const visible = useOverlayGuideStore((s) => s.visible)
  const close = useOverlayGuideStore((s) => s.close)
  const [opened, setOpened] = useState(false)
  const [granted, setGranted] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!visible) { setOpened(false); setGranted(false); return }
    const check = () => {
      if (!overlay.hasPermission()) return
      setGranted(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(close, DONE_MS)
    }
    check()
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check() })
    return () => { sub.remove(); if (timer.current) clearTimeout(timer.current) }
  }, [visible, close])

  const handleOpenSettings = () => { setOpened(true); overlay.openPermissionSettings() }

  return (
    <BottomSheet visible={visible} onClose={close}>
      <View style={styles.content}>
        <View style={styles.iconRing}>
          <View style={styles.icon}>
            <Feather name={granted ? 'check' : 'layers'} size={26} color={granted ? colors.success : colors.primary} />
          </View>
        </View>
        <Text style={styles.title} accessibilityRole="header">{granted ? 'Floating icon is on' : 'Keep Ocar one tap away'}</Text>
        <Text style={styles.body}>
          {granted
            ? 'You will see a small Ocar icon over other apps while you are online.'
            : 'A small Ocar icon over other apps while you are online, so you can use Maps and come straight back.'}
        </Text>

        {granted ? null : (
          <>
            <View style={styles.steps}>
              {STEPS.map((label, i) => (
                <View key={label} style={[styles.step, i > 0 ? styles.stepRuled : null]}>
                  <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{i + 1}</Text></View>
                  <Text style={styles.stepText}>{label}</Text>
                </View>
              ))}
            </View>

            {/* What the driver will look for on the system screen. A picture, not a control. */}
            <Text style={styles.previewCaption}>This is what you will see</Text>
            <View style={styles.preview} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={styles.previewApp}><Text style={styles.previewAppText}>O</Text></View>
              <Text style={styles.previewLabel}>Ocar</Text>
              <Switch value trackColor={{ true: colors.primary, false: colors.border }} thumbColor={colors.surface} pointerEvents="none" />
            </View>

            <View style={styles.actions}>
              <Button label={opened ? 'Open settings again' : 'Open settings'} onPress={handleOpenSettings} />
              <Button label="Not now" variant="secondary" onPress={close} />
            </View>
          </>
        )}
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, alignItems: 'center' },
  iconRing: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: colors.ink900, textAlign: 'center', marginTop: spacing.md },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.ink600, textAlign: 'center', marginTop: spacing.xs + 2, maxWidth: 320 },
  steps: { alignSelf: 'stretch', backgroundColor: colors.bg, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, marginTop: spacing.md + 2 },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm + 4 },
  stepRuled: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  stepNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primarySubtle, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontFamily: fonts.bold, fontSize: 14, color: colors.primaryDark },
  stepText: { flex: 1, minWidth: 0, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21, color: colors.ink900 },
  previewCaption: { alignSelf: 'flex-start', fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink600, marginTop: spacing.sm + 2, marginLeft: spacing.xs },
  preview: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.xs, opacity: 0.85 },
  previewApp: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  previewAppText: { fontFamily: fonts.bold, fontSize: 16, color: colors.inkInverse },
  previewLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: colors.ink900 },
  actions: { alignSelf: 'stretch', gap: spacing.sm + 2, marginTop: spacing.md + 2 },
})
