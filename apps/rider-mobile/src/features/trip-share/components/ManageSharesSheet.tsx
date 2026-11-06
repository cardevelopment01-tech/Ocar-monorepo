import { useEffect } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, fonts, radii, spacing, typography } from '@ocar/mobile-shared'
import { shareTitle, viewedText } from '../model'
import type { TripShareState } from '../useTripShare'

/** Confirms before stopping every link (one tap on a single link stops just that link, no confirmation). */
export function confirmStopAll(onConfirm: () => void): void {
  Alert.alert('Stop sharing?', 'Everyone you shared this trip with will no longer be able to follow it.', [
    { text: 'Keep sharing', style: 'cancel' },
    { text: 'Stop all', style: 'destructive', onPress: onConfirm },
  ])
}

export function ManageSharesSheet({ visible, onClose, share }: { visible: boolean; onClose: () => void; share: TripShareState }) {
  useEffect(() => {
    if (visible) { share.clearError(); void share.refresh() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on open only
  }, [visible])

  // Nothing left to manage: close by itself so the rider is not left on an empty list.
  useEffect(() => {
    if (visible && share.shares.length === 0 && share.busy === null) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the list emptying
  }, [share.shares.length, share.busy])

  const busy = share.busy !== null
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title} accessibilityRole="header">Who can see your trip</Text>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={16} color={colors.ink600} />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
            {share.shares.map((s) => (
              <View key={s.id} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{shareTitle(s)}</Text>
                  <Text style={styles.rowMeta}>{viewedText(s.viewCount)}</Text>
                </View>
                <Pressable
                  onPress={() => void share.stop(s.id)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Stop sharing with ${shareTitle(s)}`}
                  style={({ pressed }) => [styles.stopBtn, pressed ? styles.pressed : null, busy ? styles.disabled : null]}
                >
                  <Text style={styles.stopText}>Stop</Text>
                </Pressable>
              </View>
            ))}
            {share.error ? <Text style={styles.error} accessibilityRole="alert">{share.error}</Text> : null}
            <Pressable
              onPress={() => confirmStopAll(() => void share.stopAll())}
              disabled={busy || share.shares.length === 0}
              accessibilityRole="button"
              style={({ pressed }) => [styles.stopAll, pressed ? styles.pressed : null, busy ? styles.disabled : null]}
            >
              <Text style={styles.stopAllText}>Stop all</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,23,26,0.45)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, maxHeight: '80%' },
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
  stopAll: { marginTop: spacing.sm, minHeight: 48, borderRadius: radii.full, backgroundColor: colors.errorLight, alignItems: 'center', justifyContent: 'center' },
  stopAllText: { ...typography.body, color: colors.error, fontFamily: fonts.bold },
  error: { ...typography.body, color: colors.error, lineHeight: 22 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
})
