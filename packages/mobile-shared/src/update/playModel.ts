// Pure helpers for the Google Play in-app update flow (native module: packages/expo-play-update).

/** Play InstallStatus values we care about. */
export const PLAY_STATUS = { PENDING: 1, DOWNLOADING: 2, INSTALLING: 3, INSTALLED: 4, FAILED: 5, CANCELED: 6, DOWNLOADED: 11 } as const

export type PlayPhase = 'idle' | 'downloading' | 'downloaded' | 'failed'

export function phaseFromStatus(status: number): PlayPhase {
  switch (status) {
    case PLAY_STATUS.PENDING:
    case PLAY_STATUS.DOWNLOADING:
    case PLAY_STATUS.INSTALLING:
      return 'downloading'
    case PLAY_STATUS.DOWNLOADED:
      return 'downloaded'
    case PLAY_STATUS.FAILED:
    case PLAY_STATUS.CANCELED:
      return 'failed'
    default:
      return 'idle'
  }
}

/** 0-100, or null while the total size is unknown. */
export function downloadPercent(bytesDownloaded: number, totalBytes: number): number | null {
  if (!(totalBytes > 0)) return null
  return Math.max(0, Math.min(100, Math.round((bytesDownloaded / totalBytes) * 100)))
}

/**
 * Whether to advertise a soft update. With the native module, only when Play itself offers the update: a staged
 * rollout that hasn't reached this phone, or a sideloaded APK, must not be nagged about an update it can't get.
 * Without the module (iOS, older build) the store link is all there is, so the server's word is enough.
 */
export function canOfferSoft(hasNativeModule: boolean, info: { available: boolean; flexibleAllowed?: boolean } | null): boolean {
  if (!hasNativeModule) return true
  return !!info?.available && info.flexibleAllowed === true
}

export const FAILED_SNOOZE_MS = 24 * 60 * 60 * 1000
