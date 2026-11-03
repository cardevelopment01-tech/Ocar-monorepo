import { Platform } from 'react-native'
import Constants from 'expo-constants'

export type AppName = 'rider' | 'driver'

export interface AppInfo {
  app: AppName
  platform: 'android' | 'ios'
  /** Semver from app.json `version`: the only thing the server policy compares. '' when unreadable, which the
      server treats as "unknown build" and never blocks. */
  version: string
  /** versionCode / buildNumber. Sent for logs only. */
  build: string
}

export function getAppInfo(app: AppName): AppInfo {
  const cfg = Constants.expoConfig
  return {
    app,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    version: cfg?.version ?? '',
    build: String(cfg?.android?.versionCode ?? cfg?.ios?.buildNumber ?? ''),
  }
}
