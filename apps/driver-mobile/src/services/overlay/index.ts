import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { createOverlay, type NativeOverlay } from './overlay'

// requireOptionalNativeModule returns null when the installed build was made before the module existed, so an over-the-air JS
// update that ships this code to an old binary just finds the overlay "not available".
export const overlay = createOverlay(Platform.OS === 'android' ? requireOptionalNativeModule<NativeOverlay>('OcarOverlay') : null)
export type { Overlay } from './overlay'
