import { StyleSheet, View } from 'react-native'
import { colors } from '@ocar/mobile-shared'
import { RideHistoryList } from '@/features/ride-history/components/RideHistoryList'

export default function TripsScreen() {
  return (
    <View style={styles.container}>
      <RideHistoryList />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
})
