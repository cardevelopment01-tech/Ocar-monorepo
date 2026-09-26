import { ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/features/home/Text'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { font, geo, h, shadow } from '@/theme/homeTokens'
import { useNavClearance } from '@/features/home/FloatingTabBar'
import { useFleet } from '@/features/home/fleet'
import { FleetImage } from '@/features/home/sections'
import { BackIcon } from '@/features/home/icons'
import { Press } from '@/features/home/Press'

export default function FleetScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const clearance = useNavClearance()
  const fleet = useFleet()
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Press onPress={() => router.navigate('/home')} scaleTo={0.88} label="Back" style={styles.back}>
          <BackIcon />
        </Press>
        <Text style={styles.title}>Our Fleet</Text>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.list, { paddingBottom: clearance }]}>
        {fleet.map((v) => (
          <View key={v.key} style={styles.card}>
            <View style={styles.image}>
              <FleetImage item={v} box={54} w={78} />
            </View>
            <View style={styles.text}>
              <View style={styles.titleRow}>
                <Text style={styles.name}>{v.name}</Text>
                <Text style={styles.capacity}>Up to {v.seats}</Text>
              </View>
              <Text style={styles.desc}>{v.desc}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: h.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 20, paddingHorizontal: geo.gutter, paddingBottom: 10 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: h.surface, borderWidth: 1, borderColor: h.line07, alignItems: 'center', justifyContent: 'center', boxShadow: shadow.sm },
  title: { fontFamily: font.sb, fontSize: 18, color: h.ivory },
  list: { paddingTop: 8, paddingHorizontal: geo.gutter, gap: 14 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: h.surface, borderWidth: 1, borderColor: h.line06, borderRadius: 20, paddingVertical: 14, paddingRight: 16, paddingLeft: 14, boxShadow: shadow.sm },
  image: { width: 96, height: 72, borderRadius: 18, backgroundColor: h.chip, borderWidth: 1, borderColor: h.line07, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  name: { fontFamily: font.sb, fontSize: 15, color: h.ivory },
  capacity: { fontFamily: font.r, fontSize: 11, color: h.ivory, opacity: 0.4 },
  desc: { fontFamily: font.r, fontSize: 12, lineHeight: 18, color: h.ivory, opacity: 0.52 },
})
