import type { Feather } from '@expo/vector-icons'
import type { NoticeTone } from '@/components/Notices'
import type { TrackingAction, TrackingIssue } from './trackingHealth'

// What the Home row and its bottom sheet say about each cause. The row is two short lines (it never grows); the sheet has the full sentence and
// the short sequence to follow. Plain and calm: what the driver is missing (ride requests), never blame.
export type TrackingNoticeCopy = {
  tone: NoticeTone
  row: { title: string; message: string }
  /** Absent when there is nothing for the driver to do (waiting for GPS). */
  sheet?: { icon: React.ComponentProps<typeof Feather>['name']; title: string; description: string; steps: string[] }
  action?: TrackingAction
  actionLabel?: string
}

export const TRACKING_NOTICE: Record<TrackingIssue, TrackingNoticeCopy> = {
  permission: {
    tone: 'blocker',
    row: { title: 'Allow location', message: 'So Ocar can find you' },
    sheet: {
      icon: 'map-pin', title: 'Allow location for Ocar',
      description: "Ocar can't see where you are, so ride requests are paused until you allow it.",
      steps: ['Tap Open settings below', 'Choose Permissions, then Location', "Select 'Allow all the time'"],
    },
    action: 'app_settings', actionLabel: 'Allow',
  },
  background_permission: {
    tone: 'blocker',
    row: { title: "Don't miss rides", message: 'Set location to Always' },
    sheet: {
      icon: 'shield', title: 'Keep requests coming',
      description: "Without 'Allow all the time', your phone stops sharing your location when the screen turns off.",
      steps: ['Tap Open settings below', 'Choose Permissions, then Location', "Select 'Allow all the time'"],
    },
    action: 'app_settings', actionLabel: 'Allow',
  },
  services_off: {
    tone: 'blocker',
    row: { title: 'Location is off', message: 'Turn it on to get rides' },
    sheet: {
      icon: 'map-pin', title: 'Your phone location is off',
      description: "Ocar can't see where you are, so ride requests are paused until it's back on.",
      steps: ['Tap Turn on location below', 'Switch Location on, then come back'],
    },
    action: 'location_settings', actionLabel: 'Turn on',
  },
  not_running: {
    tone: 'blocker',
    row: { title: 'Location stopped', message: 'You may miss requests' },
    sheet: {
      icon: 'refresh-cw', title: 'Location sharing stopped',
      description: 'Ocar stopped sharing your location in the background, so you may miss ride requests until it is running again.',
      steps: ['Tap Restart below', "If it keeps stopping, allow location 'all the time' in Settings"],
    },
    action: 'restart', actionLabel: 'Restart',
  },
  no_signal: {
    tone: 'info',
    row: { title: 'Waiting for GPS', message: 'Move to open sky' },
  },
}

/** The label of the sheet's main button: the row's short action, said in full. */
export const SHEET_CTA: Record<TrackingAction, string> = { app_settings: 'Open settings', location_settings: 'Turn on location', restart: 'Restart' }
