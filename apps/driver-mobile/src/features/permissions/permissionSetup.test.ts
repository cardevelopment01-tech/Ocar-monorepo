import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openSettings: vi.fn(async () => {}),
  setupPush: vi.fn(async () => {}),
  getForeground: vi.fn(),
  requestForeground: vi.fn(async () => ({})),
  requestBackground: vi.fn(async () => ({})),
}))

vi.mock('react-native', () => ({ Linking: { openSettings: mocks.openSettings } }))
vi.mock('react', () => ({ useEffect: vi.fn(), useState: vi.fn() }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(), setItem: vi.fn() } }))
vi.mock('expo-location', () => ({
  getForegroundPermissionsAsync: mocks.getForeground,
  requestForegroundPermissionsAsync: mocks.requestForeground,
  requestBackgroundPermissionsAsync: mocks.requestBackground,
}))
vi.mock('@/services/notifications', () => ({ setupPushNotifications: mocks.setupPush }))
vi.mock('@ocar/mobile-shared', () => ({
  readBackgroundLocationGranted: vi.fn(), readLocationStatus: vi.fn(), readNotificationStatus: vi.fn(), shouldShowSetup: vi.fn(),
}))

import { requestPermission } from './permissionSetup'

const row = (key: string, status: 'granted' | 'ask' | 'blocked') => ({ key, title: key, reason: '', status, required: true, actionLabel: 'Allow' })

describe('requestPermission (the Allow button on the setup screen)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('opens the phone settings when Android will not show the dialog again', async () => {
    await requestPermission('notifications', [row('notifications', 'blocked')])
    expect(mocks.openSettings).toHaveBeenCalledTimes(1)
    expect(mocks.setupPush).not.toHaveBeenCalled()
  })
  it('asks for notifications through the normal registration, with the prompt on', async () => {
    await requestPermission('notifications', [row('notifications', 'ask')])
    expect(mocks.setupPush).toHaveBeenCalledWith({ prompt: true })
  })
  it('does nothing for a permission that is already on', async () => {
    await requestPermission('location', [row('location', 'granted')])
    expect(mocks.requestForeground).not.toHaveBeenCalled()
    expect(mocks.requestBackground).not.toHaveBeenCalled()
  })
  it('location step one asks for "while using the app"', async () => {
    mocks.getForeground.mockResolvedValue({ granted: false })
    await requestPermission('location', [row('location', 'ask')])
    expect(mocks.requestForeground).toHaveBeenCalledTimes(1)
    expect(mocks.requestBackground).not.toHaveBeenCalled()
  })
  it('location step two, once foreground is on, asks for "all the time"', async () => {
    mocks.getForeground.mockResolvedValue({ granted: true })
    await requestPermission('location', [row('location', 'ask')])
    expect(mocks.requestBackground).toHaveBeenCalledTimes(1)
    expect(mocks.requestForeground).not.toHaveBeenCalled()
  })
})
