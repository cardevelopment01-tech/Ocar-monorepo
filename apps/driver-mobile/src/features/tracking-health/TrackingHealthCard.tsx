import { Linking } from 'react-native'
import { NoticeRow, type NoticeDetail } from '@/components/Notices'
import { SHEET_CTA, TRACKING_NOTICE } from './trackingNotice'
import type { TrackingAction, TrackingIssue } from './trackingHealth'

type Props = {
  issue: TrackingIssue | null
  recovered: boolean
  /** Runs the Restart action (the other two actions open Settings). Coming back from Settings re-reads state by itself (AppState). */
  onRestart: () => void
  /** Opens the bottom sheet that explains this cause in full. */
  onOpenDetail: (detail: NoticeDetail) => void
}

function run(action: TrackingAction, onRestart: () => void): void {
  if (action === 'restart') { onRestart(); return }
  if (action === 'location_settings') Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => { void Linking.openSettings() })
  else void Linking.openSettings()
}

/** Whether the tracking notice is a blocker (it sorts first on Home) or just information. */
export function trackingTone(issue: TrackingIssue | null): 'blocker' | 'info' | 'ok' | null {
  if (!issue) return null
  return TRACKING_NOTICE[issue].tone === 'blocker' ? 'blocker' : 'info'
}

/** One row for everything that can stop the phone reporting the driver's location: what is wrong in two short lines and the single tap that
 *  fixes it. Tapping the row opens the full explanation. After it is fixed, a brief "back" confirmation. */
export function TrackingHealthCard({ issue, recovered, onRestart, onOpenDetail }: Props) {
  if (!issue) {
    return recovered ? <NoticeRow tone="ok" title="Location is back" message="You're live and can get ride requests" /> : null
  }
  const c = TRACKING_NOTICE[issue]
  const act = c.action
  const openDetail = c.sheet && act
    ? () => onOpenDetail({ ...c.sheet!, ctaLabel: SHEET_CTA[act], onCta: () => run(act, onRestart) })
    : undefined
  return (
    <NoticeRow
      tone={c.tone}
      title={c.row.title}
      message={c.row.message}
      {...(act && c.actionLabel ? { action: { label: c.actionLabel, onPress: () => run(act, onRestart) } } : {})}
      {...(openDetail ? { onPress: openDetail } : {})}
    />
  )
}
