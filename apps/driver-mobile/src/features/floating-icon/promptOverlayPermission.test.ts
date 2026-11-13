import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = { available: true, permitted: false }
vi.mock('@/services/overlay', () => ({ overlay: { get available() { return state.available }, hasPermission: () => state.permitted } }))
const prefs = { hasHydrated: true, floatingIconEnabled: true, overlayPermissionAsked: false, setOverlayPermissionAsked: vi.fn() }
vi.mock('@/store/useAlertPrefsStore', () => ({ useAlertPrefsStore: { getState: () => prefs } }))

import { promptOverlayPermissionOnce } from './promptOverlayPermission'
import { useOverlayGuideStore } from '@/store/useOverlayGuideStore'

describe('promptOverlayPermissionOnce', () => {
  beforeEach(() => {
    Object.assign(state, { available: true, permitted: false })
    Object.assign(prefs, { hasHydrated: true, floatingIconEnabled: true, overlayPermissionAsked: false })
    prefs.setOverlayPermissionAsked.mockClear()
    useOverlayGuideStore.setState({ visible: false })
  })

  it('opens the guide sheet once and remembers it was asked', async () => {
    await promptOverlayPermissionOnce()
    expect(useOverlayGuideStore.getState().visible).toBe(true)
    expect(prefs.setOverlayPermissionAsked).toHaveBeenCalledWith(true)
  })

  it.each([
    ['already asked', () => { prefs.overlayPermissionAsked = true }],
    ['permission already granted', () => { state.permitted = true }],
    ['icon switched off', () => { prefs.floatingIconEnabled = false }],
    ['no native module', () => { state.available = false }],
  ])('stays closed when %s', async (_name, arrange) => {
    arrange()
    await promptOverlayPermissionOnce()
    expect(useOverlayGuideStore.getState().visible).toBe(false)
  })
})
