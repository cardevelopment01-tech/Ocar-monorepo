import { requireOptionalNativeModule } from 'expo'

// Google Play In-App Updates (Android only). `null` on iOS, or in a build that predates this module:
// callers fall back to opening the store page.

export interface PlayUpdateInfo {
  available: boolean
  flexibleAllowed?: boolean
  immediateAllowed?: boolean
  /** An IMMEDIATE update was started earlier and is still running: resume it. */
  inProgress?: boolean
  /** Days since Play first saw the update, -1 if unknown. */
  stalenessDays?: number
  /** Play InstallStatus (11 = DOWNLOADED, waiting for the user to restart). */
  installStatus?: number
  totalBytes?: number
}

export type PlayUpdateResult = 'ok' | 'canceled' | 'failed'

export interface PlayUpdateState {
  /** Play InstallStatus: 1 pending, 2 downloading, 3 installing, 4 installed, 5 failed, 6 canceled, 11 downloaded. */
  status: number
  bytesDownloaded: number
  totalBytes: number
}

interface NativePlayUpdate {
  getInfo(): Promise<PlayUpdateInfo>
  start(type: 'flexible' | 'immediate'): Promise<PlayUpdateResult>
  complete(): Promise<void>
  addListener(event: 'onState', cb: (state: PlayUpdateState) => void): { remove(): void }
}

export const playUpdate = requireOptionalNativeModule<NativePlayUpdate>('ExpoPlayUpdate')
