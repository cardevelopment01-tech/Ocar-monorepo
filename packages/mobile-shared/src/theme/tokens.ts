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



// Rider palette = the redesigned home screen's system (ocar-homepage reference): a pale teal canvas,
// warm-neutral chips, near-black ink and a single deep-teal brand colour. The old teal->pink brand
// gradient and pink accent are retired here; gold is the only secondary accent (Elite / stops / badges).
const riderColors = {
  primary: '#0E8FA3',
  primaryDark: '#0A6F80',
  primaryBright: '#14ABBD',
  primaryLight: '#BFE6EC',
  primarySubtle: '#E6F3F5',
  accent: '#D6A552',
  accentLight: '#FBF3E6',
  // Driver's own brand orange, used cross-app to mark the driver's live-location pin
  // on the rider's map, intentionally not the rider's own accent.
  accentOrange: '#F97316',
  accentOrangeLight: '#FFF7ED',
  money: '#059669',
  moneyLight: '#D1FAE5',
  bg: '#F6FBFB',
  surface: '#FFFFFF',
  surface2: '#F7F6F1',
  surface3: '#EEF5F5',
  ink900: '#14171A',
  ink600: '#5F666A',
  ink400: '#8A9094',
  inkInverse: '#FFFFFF',
  border: '#E4EAEB',
  borderLight: '#EEF3F3',
  success: '#25B87A',
  successLight: '#DDF5EA',
  warning: '#D6A552',
  warningLight: '#FBF3E6',
  error: '#E5484D',
  errorLight: '#FDECEC',
  info: '#0E8FA3',
  infoLight: '#E6F3F5',
  splashBg: '#0F0F23',
} as const

// Driver = the same brand palette as the rider (one product, one look). Driver-specific: earnings accents use
// the gold accent (was orange), and `money` stays plain ink like the driver web app.
const driverColors = {
  ...riderColors,
  accentOrange: '#D6A552',
  accentOrangeLight: '#FBF3E6',
  money: '#14171A',
  moneyLight: '#F7F6F1',
  splashBg: '#0F0D1A',
} as const

export const isRider = Constants.expoConfig?.slug === 'ocar-rider'

export const colors = isRider ? riderColors : driverColors

// Both web apps' .btn-primary is this exact teal->pink gradient (apps/driver/src/index.css,
// apps/user/app/globals.css's bg-gradient-primary) -- fixed, not part of either app's own
// palette split above, since it's identical on both sites regardless of their other colors.
export const gradientPrimary = ['#14A0B5', '#0E8FA3'] as readonly [string, string]

// Driver's buttons are rounded-2xl everywhere; rider's are rounded-full (pill) everywhere --
// a real per-app shape rule in both sites' CSS, not just a color difference.
export const buttonRadius = 16

// Font family names match what useAppFonts() (see fonts.ts) registers via
// @expo-google-fonts -- these packages ship one file per weight, not a single
// variable family, so fontFamily must name the exact weight and fontWeight is
// kept alongside only as a harmless, non-functional hint (RN doesn't
// synthesize bold on a custom font that has no bold file loaded). Until
// useAppFonts() actually ran, every one of these silently fell back to the
// OS default font (Roboto/San Francisco) -- neither mobile app ever loaded
// Space Grotesk or Plus Jakarta Sans before this.
//
// display/headline are per-app, like colors/buttonRadius above -- grepped
// both web codebases: driver web applies its `font-display` (Space Grotesk)
// class on every major screen heading (Login, Home, Earnings, Wallet,
// Profile, GoOnline). Rider/user web has `font-display` configured but
// applies it NOWHERE -- zero usages across the whole app, including its own
// home page greeting -- so every rider heading is really just bold Plus
// Jakarta Sans. A single shared `typography` object previously gave
// rider-mobile Space Grotesk headlines it was never supposed to have.
const riderDisplay = {
  display: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 26, fontWeight: '700', lineHeight: 32 },
  headline: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, fontWeight: '700', lineHeight: 26 },
} as const

export const typography = {
  ...riderDisplay,
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
  // neutral ink shadows + a teal-tinted CTA glow, matching the home screen's card / button shadows
  card: { shadowColor: '#14171A', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  buttonPrimary: { shadowColor: '#0E8FA3', shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
} as const

// Font family per weight. The @expo-google-fonts packages ship one file per weight, so RN's fontWeight
// does nothing on them, components that only set fontWeight silently fell back to the system font.
export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
} as const

export const theme = { colors, typography, radii, spacing, shadows } as const
