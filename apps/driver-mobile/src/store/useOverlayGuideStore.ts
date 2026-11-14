import { create } from 'zustand'

// Whether the "Allow display over other apps" guide sheet is open. One sheet (mounted in the root layout) serves every entry point:
// the prompt after the first go-online and the switches in Notification settings.
interface OverlayGuideState {
  visible: boolean
  open: () => void
  close: () => void
}

export const useOverlayGuideStore = create<OverlayGuideState>((set) => ({
  visible: false,
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
}))
