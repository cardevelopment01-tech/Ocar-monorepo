import { Linking } from 'react-native'
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated'
import { StatusCard, type StatusTone } from '@/components/StatusCard'
import { ISSUE_COPY, type TrackingAction, type TrackingIssue } from './trackingHealth'

type Props = {
  issue: TrackingIssue | null
  recovered: boolean
  /** Runs the Restart action (the card handles the two Settings actions itself). Coming back from Settings re-reads state by itself (AppState). */
  onRestart: () => void
}

function run(action: TrackingAction, onRestart: () => void): void {
  if (action === 'restart') { onRestart(); return }
  if (action === 'location_settings') Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => { void Linking.openSettings() })
  else void Linking.openSettings()
}

// Waiting for GPS is information; every other cause means the driver cannot receive rides until it is fixed.
const TONE: Record<TrackingIssue, StatusTone> = { permission: 'blocker', background_permission: 'blocker', services_off: 'blocker', not_running: 'blocker', no_signal: 'info' }

/** One calm notice for everything that can stop the phone reporting the driver's location: what is wrong, why it matters (ride requests),
 *  and the single tap that fixes it. Eases in and out, and shows a brief "back" confirmation once it is fixed. */
export function TrackingHealthCard({ issue, recovered, onRestart }: Props) {
  if (!issue && !recovered) return null
  const entering = FadeIn.duration(220).reduceMotion(ReduceMotion.System)
  const exiting = FadeOut.duration(160).reduceMotion(ReduceMotion.System)

  if (!issue) {
    return (
      <Animated.View entering={entering} exiting={exiting} accessibilityLiveRegion="polite">
        <StatusCard tone="ok" label="Back online" title="Location is back" message="You're live and can get ride requests." />
      </Animated.View>
    )
  }

  const c = ISSUE_COPY[issue]
  const tone = TONE[issue]
  return (
    <Animated.View entering={entering} exiting={exiting} accessibilityLiveRegion="polite">
      <StatusCard
        tone={tone}
        label={tone === 'blocker' ? 'Action needed' : 'Heads up'}
        title={c.title}
        message={c.message}
        {...(c.action ? { action: { label: c.actionLabel ?? 'Fix', onPress: () => run(c.action!, onRestart) } } : {})}
      />
    </Animated.View>
  )
}
