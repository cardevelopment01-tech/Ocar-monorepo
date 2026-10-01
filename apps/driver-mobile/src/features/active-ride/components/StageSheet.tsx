import type { ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import Animated, { Easing, FadeInUp, ReduceMotion } from 'react-native-reanimated'
import { spacing } from '@ocar/mobile-shared'
import { CollapsibleRideSheet } from './CollapsibleRideSheet'
import { StageHeader, type StageHeaderProps } from './StageHeader'

export type StageSheetProps = {
  header: StageHeaderProps
  /** The one action that must never hide: arrive, enter OTP, resolve the stop, start return. */
  primary: ReactNode
  /** Booked-time row for hourly round trips; sits under the header so the destination stays the heaviest text. */
  clock?: ReactNode
  /** Changes whenever the stage (or the stop being worked) changes, to replay the crossfade. */
  stageKey: string
  /** Collapsible detail: rider, navigate, stops, cancel. */
  children: ReactNode
}

// One sheet for every in-ride stage. When the stage changes, header + primary action rise 8px
// and fade in together (~200ms ease-out): the sheet stays put while its content hands over, so
// a stage change reads as progress instead of a screen swap. Reduced motion drops to a fade.
export function StageSheet({ header, primary, clock, stageKey, children }: StageSheetProps) {
  return (
    <CollapsibleRideSheet
      alwaysVisible={
        <Animated.View
          key={stageKey}
          entering={FadeInUp.duration(200)
            .easing(Easing.out(Easing.cubic))
            .withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] })
            .reduceMotion(ReduceMotion.System)}
          style={styles.pinned}
        >
          <StageHeader {...header} />
          {clock}
          {primary}
        </Animated.View>
      }
    >
      {children}
    </CollapsibleRideSheet>
  )
}

const styles = StyleSheet.create({
  pinned: { gap: spacing.md },
})
