// Single source of truth for hex values used outside Tailwind class contexts
// (inline styles, Recharts props, Google Maps markers) — must stay in sync
// with the same tokens in tailwind.config.ts `theme.extend.colors`.
export const COLORS = {
  primary: '#4F46E5',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#0EA5E9',
  purple: '#8B5CF6',
  primaryLight: '#EEF2FF',
  successLight: '#D1FAE5',
  warningLight: '#FEF3C7',
  dangerLight: '#FEE2E2',
  infoLight: '#E0F2FE',
  purpleLight: '#EDE9FE',
  border: '#E2E8F0',
  textMuted: '#5B6B85',
  textSecondary: '#475569',
} as const
