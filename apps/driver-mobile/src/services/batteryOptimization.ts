import { Alert, Linking, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

const ASKED_KEY = 'ocar_battery_optimization_asked'

// Ride requests only arrive while the location foreground service and socket stay alive, and
// OEM battery savers (Xiaomi, Oppo, Vivo, Realme, Samsung "sleeping apps") freeze both even so.
// Opens the system "battery optimization" list rather than requesting the exemption directly:
// REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is restricted by Play policy, the settings screen is not.
// Asked once per install, right after the first successful go-online.
export async function promptBatteryOptimizationOnce(): Promise<void> {
  if (Platform.OS !== 'android') return
  try {
    if (await AsyncStorage.getItem(ASKED_KEY)) return
    await AsyncStorage.setItem(ASKED_KEY, '1')
  } catch {
    return
  }
  Alert.alert(
    'Keep Ocar running',
    'Some phones put apps to sleep to save battery, which can make you miss ride requests. Set Ocar to "Don\'t optimise" or "Unrestricted" so requests keep arriving.',
    [
      { text: 'Later', style: 'cancel' },
      {
        text: 'Open settings',
        onPress: () => {
          Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS').catch(() => Linking.openSettings())
        },
      },
    ],
  )
}
