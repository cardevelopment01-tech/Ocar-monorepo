import { StyleSheet, Text, View } from 'react-native'
import { Feather } from '@expo/vector-icons'
import { colors, radii, typography, fonts } from '@ocar/mobile-shared'
import { statusKind } from '../statusKind'

const KIND_STYLE = {
  success: { bg: colors.successLight, fg: colors.success },
  error: { bg: colors.errorLight, fg: colors.error },
  info: { bg: colors.infoLight, fg: colors.info },
  warning: { bg: colors.warningLight, fg: colors.warning },
} as const

export function StatusBadge({ status }: { status: string }) {
  const kind = statusKind(status)
  const { bg, fg } = KIND_STYLE[kind]
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {kind === 'success' ? <Feather name="check-circle" size={10} color={fg} /> : null}
      {kind === 'error' ? <Feather name="x-circle" size={10} color={fg} /> : null}
      {kind === 'info' ? <Feather name="clock" size={10} color={fg} /> : null}
      {kind === 'warning' ? <View style={[styles.dot, { backgroundColor: fg }]} /> : null}
      <Text style={[styles.text, { color: fg }]}>{status.replace(/_/g, ' ')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.full, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { ...typography.caption, fontSize: 11, fontFamily: fonts.semibold, textTransform: 'capitalize' },
})
