import { StyleSheet, View } from 'react-native'
import MapView from 'react-native-maps'

// react-native-maps' first MapView instance in an app process pays a real
// multi-second native init cost on Android (Google Play Services binding +
// tile renderer setup) -- a well-documented library quirk, not something a
// prop fixes. Unlike driver-mobile (whose home tab already mounts a MapView
// the instant the driver logs in), rider-mobile's home tab has no map at
// all -- the rider's first MapView is deep in the booking flow or active-ride
// tracking, so that screen ate the whole cold-start delay and looked blank
// for 5-10s. Mounting one here, invisible and tiny, pays that cost once at
// app launch instead, off the critical path.
export function MapWarmup() {
  return (
    <View style={styles.hidden} pointerEvents="none">
      <MapView style={StyleSheet.absoluteFill} liteMode />
    </View>
  )
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, top: -1000 },
})
