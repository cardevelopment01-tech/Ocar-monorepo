// Brand system shared by the rider and driver apps, ported 1:1 from the :root block (and the literal
// values used beside it) in ocar-homepage-reference.html.
import { Easing } from 'react-native-reanimated'

export const h = {
  canvas: '#F6FBFB',
  surface: '#FFFFFF',
  chip: '#F7F6F1',
  ivory: '#14171A',
  ivoryDim: 'rgba(20,23,26,0.58)',
  ivoryFaint: 'rgba(20,23,26,0.34)',
  teal: '#0E8FA3',
  tealSoft: 'rgba(14,143,163,0.14)',
  tealFaint: 'rgba(14,143,163,0.07)',
  gold: '#D6A552',
  goldLight: '#E7C27D',
  live: '#25B87A',
  // hairlines used across the file (border / divider alphas)
  line06: 'rgba(20,23,26,0.06)',
  line07: 'rgba(20,23,26,0.07)',
  line08: 'rgba(20,23,26,0.08)',
  line09: 'rgba(20,23,26,0.09)',
  line10: 'rgba(20,23,26,0.10)',
  line13: 'rgba(20,23,26,0.13)',
} as const

// Card / label recipes shared by every rider screen (the home screen's .card and .tt-label).
export const card = { backgroundColor: h.surface, borderWidth: 1, borderColor: h.line10, borderRadius: 20 } as const
export const sectionLabel = {
  fontFamily: 'PlusJakartaSans_700Bold',
  fontSize: 12,
  letterSpacing: 1.4,
  textTransform: 'uppercase',
  color: h.teal,
} as const

// RN 0.86 (new arch) parses CSS box-shadow strings, spread included.
export const shadow = {
  sm: '0 2px 8px rgba(20,23,26,0.06), 0 1px 2px rgba(20,23,26,0.05)',
  md: '0 10px 28px rgba(20,23,26,0.09), 0 2px 6px rgba(20,23,26,0.05)',
  lg: '0 24px 48px rgba(20,23,26,0.14), 0 10px 20px rgba(20,23,26,0.07)',
} as const

// Only the weights the phone frame actually renders (400/500/600/700) --
// Inter 800 / Space Grotesk in the file belong to the unused wordmark and the
// page's own <h1>, not the screen. All four are already in useAppFonts().
export const font = {
  r: 'PlusJakartaSans_400Regular',
  m: 'PlusJakartaSans_500Medium',
  sb: 'PlusJakartaSans_600SemiBold',
  b: 'PlusJakartaSans_700Bold',
} as const

// Sheet / map geometry (px), the reference's PEEK / EXPANDED and paddings.
export const geo = {
  peek: 120,
  expanded: 236,
  minDrag: 120 * 0.55,
  sheetOverlap: 22,
  gutter: 18,
  navHeight: 64,
  navBottom: 16,
  scrollClearance: 110,
} as const

// cubic-bezier curves named after where the reference uses them.
export const ease = {
  sheet: Easing.bezier(0.22, 0.9, 0.32, 1), // map height / sheet margin
  press: Easing.bezier(0.3, 0.7, 0.3, 1), // .icon-btn, .chip, .tt-tile svg ...
  rowIn: Easing.bezier(0.2, 0.7, 0.25, 1), // rows + .reveal
  ring: Easing.bezier(0.2, 0.7, 0.2, 1), // chip ring pulse, toast
  push: Easing.bezier(0.22, 0.7, 0.15, 1), // fleet/info screen push
  css: Easing.bezier(0.25, 0.1, 0.25, 1), // CSS `ease`
  inOut: Easing.bezier(0.42, 0, 0.58, 1), // CSS `ease-in-out`
} as const

// Tap-vs-drag thresholds from the pointer handlers.
export const drag = { tapMs: 250, tapPx: 6, scrollGate: 4, collapseAt: 6, restoreAt: 2 } as const
