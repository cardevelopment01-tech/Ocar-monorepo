// Ported directly from the live web apps' Tailwind configs
// (apps/driver/tailwind.config.ts, apps/user/tailwind.config.ts) -- these are
// the actual brand palettes, replacing this file's original indigo/violet
// placeholder values (drafted from a DESIGN.md spec, never the real site).
// Driver and rider ship different brand accents (driver: teal+orange, rider:
// teal+pink+money-green), so this module picks the palette for whichever app
// is bundling it via its Expo slug -- no env var or setup step needed, since
// app.json's slug is always present and already distinct per app
// (ocar-driver / ocar-rider).

import Constants from 'expo-constants'

const driverColors = {
  primary: '#0A9FB0',
  primaryDark: '#087C89',
  primaryBright: '#0A9FB0',
  primaryLight: '#B8E9EE',
  primarySubtle: '#E4F8FA',
  accent: '#F97316',
  accentLight: '#FFF7ED',
  accentOrange: '#F97316',
  accentOrangeLight: '#FFF7ED',
  // Driver web shows earnings in plain ink (Earnings.tsx), not a green accent --
  // kept as its own token (rather than reusing ink900 at call sites) so both
  // palettes expose the same shape.
  money: '#0F172A',
  moneyLight: '#F1F5F9',
  bg: '#F5F8FF',
  surface: '#FFFFFF',
  surface2: '#F0F4FD',
  surface3: '#E8EEFA',
  ink900: '#0F172A',
  ink600: '#475569',
  ink400: '#64748B',
  inkInverse: '#FFFFFF',
  border: '#E2E8F0',
  borderLight: '#F1F5F9',
  success: '#22C55E',
  successLight: '#DCFCE7',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  error: '#EF4444',
  errorLight: '#FEE2E2',
  info: '#3B82F6',
  infoLight: '#DBEAFE',
  splashBg: '#0F172A',
} as const

const riderColors = {
  primary: '#0A9FB0',
  primaryDark: '#087C89',
  primaryBright: '#22B8C9',
  primaryLight: '#B8E9EE',
  primarySubtle: '#E4F8FA',
  accent: '#DC3E93',
  accentLight: '#FBE0EE',
  // Driver's own brand orange, used cross-app to mark the driver's live-location pin
  // on the rider's map -- intentionally not the rider's own pink accent.
  accentOrange: '#F97316',
  accentOrangeLight: '#FFF7ED',
  money: '#059669',
  moneyLight: '#D1FAE5',
  bg: '#F5F7FF',
  surface: '#FFFFFF',
  surface2: '#F8FAFF',
  surface3: '#EEF3FF',
  ink900: '#0F172A',
  ink600: '#475569',
  ink400: '#64748B',
  inkInverse: '#FFFFFF',
  border: '#E8EEFF',
  borderLight: '#F1F5FF',
  success: '#10B981',
  successLight: '#D1FAE5',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  error: '#EF4444',
  errorLight: '#FEE2E2',
  info: '#0EA5E9',
  infoLight: '#E0F2FE',
  splashBg: '#0F0F23',
} as const

const isRider = Constants.expoConfig?.slug === 'ocar-rider'

export const colors = isRider ? riderColors : driverColors

export const typography = {
  display: { fontFamily: 'Space Grotesk', fontSize: 28, fontWeight: '700', lineHeight: 34, letterSpacing: -0.84 },
  headline: { fontFamily: 'Space Grotesk', fontSize: 22, fontWeight: '700', lineHeight: 29, letterSpacing: -0.44 },
  title: { fontFamily: 'Plus Jakarta Sans', fontSize: 18, fontWeight: '600', lineHeight: 25 },
  body: { fontFamily: 'Plus Jakarta Sans', fontSize: 16, fontWeight: '400', lineHeight: 26 },
  label: { fontFamily: 'Plus Jakarta Sans', fontSize: 13, fontWeight: '500', lineHeight: 18 },
  caption: { fontFamily: 'Plus Jakarta Sans', fontSize: 12, fontWeight: '400', lineHeight: 18 },
} as const

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  full: 9999,
} as const

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const

// The Teal Shadow Rule: both live web apps tint every shadow rgba(10,159,176,X)
// (their shared brand teal) instead of neutral gray -- same tint works for both
// apps here since it's identical in both tailwind configs.
export const shadows = {
  card: { shadowColor: 'rgba(10,159,176,1)', shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  buttonPrimary: { shadowColor: 'rgba(10,159,176,1)', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
} as const

export const theme = { colors, typography, radii, spacing, shadows } as const
