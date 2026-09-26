import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { h } from '@/theme/homeTokens'
import { RideHistoryList } from '@/features/ride-history/components/RideHistoryList'

export default function TripsScreen() {
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <RideHistoryList />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: h.canvas },
})
