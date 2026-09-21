import { useEffect } from 'react'
import { Keyboard } from 'react-native'
import { Easing, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'

// react-native-keyboard-controller's continuous height-tracking hook
// (useReanimatedKeyboardAnimation / useAnimatedKeyboard) has a confirmed
// compatibility bug under Fabric/New Architecture on Android in this exact
// project -- found the hard way porting driver-mobile's active-ride flow.
// This uses RN core's own discrete Keyboard.addListener('keyboardDidShow'/
// 'keyboardDidHide') instead, which isn't affected by that bug, and animates
// the two-state transition itself rather than needing a continuous native value.
//
// Needed because both mobile apps run with edgeToEdgeEnabled (android/gradle.properties)
// and android:windowSoftInputMode="adjustResize" (AndroidManifest.xml) --
// under edge-to-edge, adjustResize does not reliably shrink the content the
// way it does for a normal (non-edge-to-edge) window, so a bottom-docked
// input (a Modal sheet, an absolute-positioned sheet, or even a normal
// in-flow one) can end up sitting directly behind the keyboard with no
// automatic reflow at all -- confirmed on rider-mobile's AddStopSheet, whose
// search input had no keyboard handling of any kind.
export function useKeyboardOffset(): SharedValue<number> {
  const offset = useSharedValue(0)

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      offset.set(withTiming(e.endCoordinates.height, { duration: 220, easing: Easing.out(Easing.quad) }))
    })
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      offset.set(withTiming(0, { duration: 220, easing: Easing.out(Easing.quad) }))
    })
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [offset])

  return offset
}
