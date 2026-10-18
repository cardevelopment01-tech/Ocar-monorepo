import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, BackHandler, Image, Linking, Modal, Platform, Pressable, StyleSheet, View, type ImageSourcePropType } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button } from '../ui/Button'
import { SlideModal } from '../ui/SlideModal'
import { Text } from '../ui/Text'
import { getSecureItem, setSecureItem } from '../storage/secureStorage'
import { colors, radii, spacing, typography } from '../theme/tokens'
import { getAppInfo, type AppName } from './appInfo'
import { hasStorePage, openStorePage } from './storeLinks'
import { FAILED_SNOOZE_MS, canOfferSoft } from './playModel'
import { recordFirstOpen } from './reviewPrompt'
import { usePlayUpdate } from './usePlayUpdate'
import { SOFT_SNOOZE_MS, decideUpdateUi, markUpdateShown, useForcedHardUpdate, type VersionPolicy } from './updateState'

const POLICY_TIMEOUT_MS = 5_000
const RECHECK_MS = 30 * 60 * 1000
const SNOOZE_KEY = 'ocar_update_snoozed_until'

// Fail-open: any error, timeout or odd answer is "no update wanted". A broken policy endpoint must never lock
// anyone out of the app.
async function fetchPolicy(baseURL: string, app: AppName): Promise<VersionPolicy | null> {
  const info = getAppInfo(app)
  const q = new URLSearchParams({ app: info.app, platform: info.platform, version: info.version })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), POLICY_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseURL}/api/v1/app/version-policy?${q.toString()}`, { signal: ctrl.signal })
    if (!res.ok) return null
    const body = (await res.json()) as VersionPolicy
    return body.action === 'soft' || body.action === 'hard' || body.action === 'none' ? body : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

type Props = {
  app: AppName
  baseURL: string
  /** True while the user must not be interrupted (live ride, online driver, payment). */
  isBusy: boolean
  logoSource: ImageSourcePropType
  supportMailto: string
}

/**
 * Soft "update available" sheet and the hard "update required" screen. Mount once in the root layout, after the
 * navigator. The server (GET /app/version-policy) decides which one; a 426 UPGRADE_REQUIRED from the API forces
 * the hard screen immediately.
 *
 * Android with the Play module: soft = flexible download (pill, then a Restart bar that only the user's tap
 * triggers), hard = Play's immediate update. Otherwise both just open the store page.
 */
export function UpdateGate({ app, baseURL, isBusy, logoSource, supportMailto }: Props) {
  const insets = useSafeAreaInsets()
  const forcedHard = useForcedHardUpdate()
  const [policy, setPolicy] = useState<VersionPolicy | null>(null)
  const [snoozedUntil, setSnoozedUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [noStore, setNoStore] = useState(false)
  const lastCheck = useRef(0)
  const play = usePlayUpdate()
  const { refresh: refreshPlay } = play

  useEffect(() => { void recordFirstOpen() }, [])

  useEffect(() => {
    getSecureItem(SNOOZE_KEY).then((v) => { if (v) setSnoozedUntil(Number(v) || 0) }).catch(() => {})
  }, [])

  const check = useCallback(async () => {
    if (Date.now() - lastCheck.current < RECHECK_MS && lastCheck.current !== 0) return
    lastCheck.current = Date.now()
    const p = await fetchPolicy(baseURL, app)
    setPolicy(p)
    setNow(Date.now())
  }, [baseURL, app])

  useEffect(() => {
    void check()
    void refreshPlay()
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { void check(); void refreshPlay() }
    })
    return () => sub.remove()
  }, [check, refreshPlay])

  const ui = decideUpdateUi({ action: policy?.action ?? 'none', forcedHard, busy: isBusy, snoozedUntil, now })
  const storeUrl = policy?.store_url ?? null
  const canOpen = hasStorePage()

  const snooze = (ms = SOFT_SNOOZE_MS) => {
    const until = Date.now() + ms
    setSnoozedUntil(until)
    setNow(Date.now())
    setSecureItem(SNOOZE_KEY, String(until)).catch(() => {})
  }
  const openStore = async () => {
    const opened = await openStorePage(storeUrl).catch(() => false)
    setNoStore(!opened)
  }
  // Soft "Update": Play flexible download when available, else the store page.
  const updateSoft = async () => {
    if (!play.available) { snooze(); void openStore(); return }
    const r = await play.start('flexible')
    if (r === 'canceled') snooze()
    else if (r === 'failed') snooze(FAILED_SNOOZE_MS)
    // 'ok': the download pill takes over via Play's state events.
  }
  // Hard "Update now": Play's full-screen immediate update; cancelling leaves the user on this screen.
  const updateHard = async () => {
    if (play.available && (play.info?.immediateAllowed || play.info?.inProgress)) {
      const r = await play.start('immediate')
      if (r !== 'failed') return
    }
    void openStore()
  }

  const softVisible = ui === 'soft' && canOfferSoft(play.available, play.info) && play.phase === 'idle'
  const showPill = play.phase === 'downloading'
  const showRestart = play.phase === 'downloaded' && !isBusy
  const surfaceShown = ui === 'hard' || softVisible || showPill || showRestart
  useEffect(() => { if (surfaceShown) markUpdateShown() }, [surfaceShown])

  const exitOnBack = () => { BackHandler.exitApp(); return true }

  if (ui === 'hard') {
    return (
      <Modal visible animationType="fade" statusBarTranslucent onRequestClose={exitOnBack}>
        <View style={[styles.hard, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg }]}>
          <Image source={logoSource} style={styles.logo} resizeMode="contain" accessibilityIgnoresInvertColors />
          <Text style={styles.hardTitle} accessibilityRole="header">Please update Ocar to continue</Text>
          <Text style={styles.body}>
            This version is no longer supported. {app === 'rider' ? 'Update to keep booking rides.' : 'Update to keep taking rides.'}
          </Text>
          <View style={styles.actions}>
            {canOpen ? <Button label={updateLabel()} onPress={() => void updateHard()} /> : null}
            {noStore || !canOpen ? (
              <Text style={styles.hint}>Open the app store on your phone and update Ocar.</Text>
            ) : null}
            <Pressable onPress={() => void Linking.openURL(supportMailto).catch(() => {})} accessibilityRole="button" style={styles.link}>
              <Text style={styles.linkText}>Contact support</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    )
  }


  return (
    <>
    <SlideModal visible={softVisible} onRequestClose={() => snooze()}>
      <View style={styles.sheetWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => snooze()} accessibilityLabel="Not now" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.sheetTitle} accessibilityRole="header">A new version of Ocar is ready</Text>
          <Text style={styles.body}>Update for the latest fixes and improvements.</Text>
          <View style={styles.actions}>
            {canOpen ? <Button label={updateLabel()} onPress={() => void updateSoft()} /> : null}
            <Pressable onPress={() => snooze()} accessibilityRole="button" style={styles.link}>
              <Text style={styles.linkText}>Not now</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SlideModal>
    {showPill ? (
      <View pointerEvents="none" style={[styles.pill, { top: insets.top + spacing.sm }]} accessibilityLiveRegion="polite">
        <Text style={styles.pillText} accessibilityLabel="Downloading update">
          {play.percent === null ? 'Downloading update…' : `Downloading update… ${play.percent}%`}
        </Text>
      </View>
    ) : null}
    {showRestart ? (
      <View style={[styles.bar, { bottom: insets.bottom + spacing.md }]} accessibilityLiveRegion="polite">
        <Text style={styles.barText}>Update ready. Restart to finish.</Text>
        <Pressable onPress={play.restart} accessibilityRole="button" style={styles.barBtn}>
          <Text style={styles.barBtnText}>Restart</Text>
        </Pressable>
      </View>
    ) : null}
    </>
  )
}

function updateLabel(): string {
  return Platform.OS === 'ios' ? 'Open App Store' : 'Update now'
}

const styles = StyleSheet.create({
  hard: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 88, height: 88, marginBottom: spacing.lg },
  hardTitle: { ...typography.headline, color: colors.ink900, textAlign: 'center' },
  body: { ...typography.body, color: colors.ink600, textAlign: 'center', marginTop: spacing.sm },
  actions: { alignSelf: 'stretch', marginTop: spacing.lg, gap: spacing.sm },
  hint: { ...typography.caption, color: colors.ink600, textAlign: 'center' },
  link: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  linkText: { ...typography.label, color: colors.primary },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii['2xl'],
    borderTopRightRadius: radii['2xl'],
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  pill: {
    position: 'absolute', alignSelf: 'center', backgroundColor: colors.ink900, borderRadius: radii.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  pillText: { ...typography.label, color: colors.inkInverse },
  bar: {
    position: 'absolute', left: spacing.md, right: spacing.md, minHeight: 56, backgroundColor: colors.ink900,
    borderRadius: radii.lg, paddingLeft: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  barText: { ...typography.label, color: colors.inkInverse, flexShrink: 1 },
  barBtn: { minHeight: 48, minWidth: 80, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  barBtnText: { ...typography.label, color: colors.primaryLight },
  sheetTitle: { ...typography.title, color: colors.ink900, textAlign: 'center' },
})
