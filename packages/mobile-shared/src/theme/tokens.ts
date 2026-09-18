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

// Both web apps' .btn-primary is this exact teal->pink gradient (apps/driver/src/index.css,
// apps/user/app/globals.css's bg-gradient-primary) -- fixed, not part of either app's own
// palette split above, since it's identical on both sites regardless of their other colors.
export const gradientPrimary = ['#0A9FB0', '#DC3E93'] as const

// Driver's buttons are rounded-2xl everywhere; rider's are rounded-full (pill) everywhere --
// a real per-app shape rule in both sites' CSS, not just a color difference.
export const buttonRadius = isRider ? 9999 : 16

// Font family names match what useAppFonts() (see fonts.ts) registers via
// @expo-google-fonts -- these packages ship one file per weight, not a single
// variable family, so fontFamily must name the exact weight and fontWeight is
// kept alongside only as a harmless, non-functional hint (RN doesn't
// synthesize bold on a custom font that has no bold file loaded). Until
// useAppFonts() actually ran, every one of these silently fell back to the
// OS default font (Roboto/San Francisco) -- neither mobile app ever loaded
// Space Grotesk or Plus Jakarta Sans before this.
export const typography = {
  display: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 28, fontWeight: '700', lineHeight: 34, letterSpacing: -0.84 },
  headline: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 22, fontWeight: '700', lineHeight: 29, letterSpacing: -0.44 },
  title: { fontFamily: 'PlusJakartaSans_600SemiBold', fontSize: 18, fontWeight: '600', lineHeight: 25 },
  body: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 16, fontWeight: '400', lineHeight: 26 },
  label: { fontFamily: 'PlusJakartaSans_500Medium', fontSize: 13, fontWeight: '500', lineHeight: 18 },
  caption: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, fontWeight: '400', lineHeight: 18 },
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
