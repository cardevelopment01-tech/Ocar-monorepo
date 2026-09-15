// Ported from DESIGN.md's frontmatter token block — keep in sync with that file, not the other way around.

export const colors = {
  primary: '#4F46E5',
  primaryDark: '#4338CA',
  primaryBright: '#6366F1',
  primaryLight: '#C7D2FE',
  primarySubtle: '#EEF2FF',
  accentViolet: '#7C3AED',
  accentVioletLight: '#EDE9FE',
  accentOrange: '#F97316',
  accentOrangeLight: '#FFF7ED',
  bg: '#F5F7FF',
  surface: '#FFFFFF',
  surface2: '#F5F7FF',
  surface3: '#EEF0FF',
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
  splashBg: '#0F0D1A',
} as const

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

// The Indigo Shadow Rule (DESIGN.md): every shadow is tinted rgba(79,70,229,X), never neutral gray.
export const shadows = {
  card: { shadowColor: 'rgba(79,70,229,1)', shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  buttonPrimary: { shadowColor: 'rgba(79,70,229,1)', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
} as const

export const theme = { colors, typography, radii, spacing, shadows } as const
