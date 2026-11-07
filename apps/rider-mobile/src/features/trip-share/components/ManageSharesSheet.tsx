import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Press, SlideModal, colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { shareTitle, viewedText } from '../model'
import type { TripShareState } from '../useTripShare'

/** Confirms before stopping every link (one tap on a single link stops just that link, no confirmation). */
export function confirmStopAll(onConfirm: () => void, includesSos = false): void {
  const sos = includesSos ? ' This includes the live link your emergency contacts received when you pressed SOS.' : ''
  Alert.alert('Stop sharing?', `Everyone you shared this trip with will no longer be able to follow it.${sos}`, [
    { text: 'Keep sharing', style: 'cancel' },
    { text: 'Stop all', style: 'destructive', onPress: onConfirm },
  ])
}

export function ManageSharesSheet({ visible, onClose, share }: { visible: boolean; onClose: () => void; share: TripShareState }) {
  const insets = useSafeAreaInsets()

  // 'loading' until the open-time read finishes: an empty list before that is only "not read yet", never "nothing to manage".
  const [load, setLoad] = useState<'loading' | 'ready' | 'failed'>('loading')
  const read = () => { setLoad('loading'); void share.refresh().then((ok) => setLoad(ok ? 'ready' : 'failed')) }
  useEffect(() => {
    if (visible) { share.clearError(); read() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on open only
  }, [visible])

  // Nothing left to manage: close by itself so the rider is not left on an empty list.
  useEffect(() => {
    if (visible && load === 'ready' && share.shares.length === 0 && share.busy === null) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the list emptying
  }, [load, share.shares.length, share.busy])

  const busy = share.busy !== null
  return (
    <SlideModal visible={visible} onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} accessibilityViewIsModal>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <Text style={styles.title} accessibilityRole="header">Who can see your trip</Text>
          <Press onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" scaleTo={0.9} style={styles.closeBtn}>
            <Feather name="x" size={16} color={colors.ink600} />
          </Press>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {share.shares.map((s) => (
            <Animated.View key={s.id} entering={FadeIn.duration(220)} exiting={FadeOut.duration(160)} layout={LinearTransition.duration(220)} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{shareTitle(s)}</Text>
                <Text style={styles.rowMeta}>{viewedText(s.viewCount)}</Text>
              </View>
              <Press
                onPress={() => void share.stop(s.id)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Stop sharing with ${shareTitle(s)}`}
                scaleTo={0.94}
                hit={busy ? styles.disabled : null}
                style={styles.stopBtn}
              >
                <Text style={styles.stopText}>Stop</Text>
              </Press>
            </Animated.View>
          ))}
          {load === 'failed' ? (
            <View style={styles.row}>
              <Text style={[styles.rowTitle, styles.rowText]}>Could not load your links. Check your connection.</Text>
              <Press onPress={read} accessibilityLabel="Try again" scaleTo={0.94} style={styles.stopBtn}><Text style={styles.retryText}>Retry</Text></Press>
            </View>
          ) : null}
          {share.error ? <Text style={styles.error} accessibilityRole="alert">{share.error}</Text> : null}
          <Press
            onPress={() => confirmStopAll(() => void share.stopAll(), share.shares.some((s) => s.isSos))}
            disabled={busy || share.shares.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Stop all"
            scaleTo={0.98}
            hit={[styles.stopAllHit, busy ? styles.disabled : null]}
            style={styles.stopAll}
          >
            <Text style={styles.stopAllText}>Stop all</Text>
          </Press>
        </ScrollView>
      </View>
    </SlideModal>
  )
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%',
    backgroundColor: colors.surface, borderTopLeftRadius: radii['3xl'], borderTopRightRadius: radii['3xl'],
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
    boxShadow: '0 -6px 32px rgba(14,143,163,0.10)', // DESIGN.md sheet shadow: teal-tinted, directional
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(14,143,163,0.15)', alignSelf: 'center', marginBottom: spacing.md }, // DESIGN.md: teal-tinted 40x4 handle
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { ...typography.title, color: colors.ink900, fontFamily: fonts.bold },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 0 },
  body: { gap: spacing.sm, paddingBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, paddingLeft: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface2 },
  rowText: { flex: 1 },
  rowTitle: { ...typography.body, color: colors.ink900, fontFamily: fonts.semibold, lineHeight: 22 },
  rowMeta: { ...typography.caption, color: colors.ink600 },
  stopBtn: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  stopText: { ...typography.label, color: colors.error, fontFamily: fonts.bold },
  retryText: { ...typography.label, color: colors.primaryDark, fontFamily: fonts.bold },
  stopAllHit: { marginTop: spacing.sm },
  stopAll: { minHeight: 48, borderRadius: radii.full, backgroundColor: colors.errorLight, alignItems: 'center', justifyContent: 'center' },
  stopAllText: { ...typography.body, color: colors.error, fontFamily: fonts.bold },
  error: { ...typography.body, color: colors.error, lineHeight: 22 },
  disabled: { opacity: 0.5 },
})
