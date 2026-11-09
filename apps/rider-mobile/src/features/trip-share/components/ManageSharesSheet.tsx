import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { Press, SlideModal, font, h } from '@ocar/mobile-shared'
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
      <View style={styles.sheet} accessibilityViewIsModal>
        <LinearGradient colors={['#12A0B6', '#0B7F93', '#08566A']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.head}>
          <View style={styles.handle} pointerEvents="none" />
          <Press onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" scaleTo={0.9} style={styles.closeBtn}>
            <Feather name="x" size={17} color="#FFFFFF" />
          </Press>
          <View style={styles.liveChip} accessibilityElementsHidden importantForAccessibility="no">
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
          <Text style={styles.title} accessibilityRole="header">Who can see your trip</Text>
          <Text style={styles.lead}>{share.shares.length === 1 ? '1 link is active' : `${share.shares.length} links are active`}. Stop any link and it ends at once.</Text>
        </LinearGradient>

        <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, { paddingBottom: Math.max(insets.bottom, 18) + 6 }]} showsVerticalScrollIndicator={false}>
          {share.shares.map((s, i) => (
            <Animated.View key={s.id} entering={FadeInDown.duration(320).delay(80 + i * 60)} exiting={FadeOut.duration(160)} layout={LinearTransition.duration(220)} style={styles.row}>
              <View style={[styles.badge, s.isSos ? { backgroundColor: h.dangerWash } : null]}>
                <Feather name={s.isSos ? 'alert-triangle' : 'link-2'} size={18} color={s.isSos ? h.danger : h.tealText} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{shareTitle(s)}</Text>
                <View style={styles.metaRow}>
                  <Feather name="eye" size={13} color={s.viewCount > 0 ? h.tealText : h.faint} />
                  <Text style={[styles.rowMeta, s.viewCount > 0 ? { color: h.tealText } : null]}>{viewedText(s.viewCount)}</Text>
                </View>
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
              <Press onPress={read} accessibilityLabel="Try again" scaleTo={0.94} style={styles.retryBtn}><Text style={styles.retryText}>Retry</Text></Press>
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
            <Feather name="slash" size={16} color={h.danger} />
            <Text style={styles.stopAllText}>Stop sharing with everyone</Text>
          </Press>
        </ScrollView>
      </View>
    </SlideModal>
  )
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%',
    backgroundColor: h.surface, borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden',
    boxShadow: '0 -12px 32px rgba(20,23,26,0.18)',
  },
  head: { paddingHorizontal: 18, paddingTop: 54, paddingBottom: 20 },
  handle: { position: 'absolute', top: 10, alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.55)' },
  closeBtn: { position: 'absolute', top: 14, right: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  liveChip: { position: 'absolute', top: 16, left: 18, flexDirection: 'row', alignItems: 'center', gap: 7, height: 28, paddingLeft: 10, paddingRight: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.32)' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#5FE3A8' },
  liveText: { fontFamily: font.xb, fontSize: 11.5, letterSpacing: 1.2, color: '#FFFFFF' },
  title: { fontFamily: font.xb, fontSize: 22, letterSpacing: -0.4, color: '#FFFFFF' },
  lead: { fontFamily: font.m, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.86)', marginTop: 3, paddingRight: 56 },
  scroll: { flexGrow: 0 },
  body: { gap: 10, paddingHorizontal: 18, paddingTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, paddingLeft: 14, paddingRight: 8, borderRadius: 20, backgroundColor: h.chip },
  badge: { width: 40, height: 40, borderRadius: 20, backgroundColor: h.tealWash, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: font.b, fontSize: 15, color: h.ivory },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  rowMeta: { fontFamily: font.m, fontSize: 12.5, color: h.muted, fontVariant: ['tabular-nums'] },
  stopBtn: { minWidth: 64, height: 40, borderRadius: 20, backgroundColor: h.dangerWash, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  stopText: { fontFamily: font.b, fontSize: 13.5, color: h.danger },
  retryBtn: { minWidth: 64, height: 40, borderRadius: 20, backgroundColor: h.tealWash, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  retryText: { fontFamily: font.b, fontSize: 13.5, color: h.tealText },
  stopAllHit: { marginTop: 6 },
  stopAll: { minHeight: 52, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(194,59,59,0.3)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  stopAllText: { fontFamily: font.b, fontSize: 15, color: h.danger },
  error: { fontFamily: font.m, fontSize: 14, lineHeight: 20, color: h.danger },
  disabled: { opacity: 0.5 },
})
