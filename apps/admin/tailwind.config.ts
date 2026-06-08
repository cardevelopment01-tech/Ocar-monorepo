import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Sidebar
        sidebar:             '#0F172A',
        'sidebar-hover':     '#1E293B',
        'sidebar-active':    '#1D4ED8',
        'sidebar-border':    '#1E293B',
        'sidebar-text':      '#94A3B8',
        'sidebar-active-text': '#FFFFFF',
        // Content
        canvas:    '#F1F5F9',
        surface:   '#FFFFFF',
        'surface-2': '#F8FAFC',
        // Brand
        primary:       '#2563EB',
        'primary-dark':  '#1D4ED8',
        'primary-light': '#EFF6FF',
        // Semantic
        success:         '#10B981',
        'success-light': '#ECFDF5',
        warning:         '#F59E0B',
        'warning-light': '#FFFBEB',
        danger:          '#EF4444',
        'danger-light':  '#FEF2F2',
        info:            '#0EA5E9',
        'info-light':    '#F0F9FF',
        purple:          '#8B5CF6',
        'purple-light':  '#F5F3FF',
        // Text
        'text-primary':   '#0F172A',
        'text-secondary': '#475569',
        'text-muted':     '#94A3B8',
        'text-inverse':   '#FFFFFF',
        // Borders
        border:       '#E2E8F0',
        'border-light': '#F1F5F9',
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
      },
      fontSize: {
        xs:   ['11px', { lineHeight: '16px' }],
        sm:   ['12px', { lineHeight: '18px' }],
        base: ['13px', { lineHeight: '20px' }],
        md:   ['14px', { lineHeight: '22px' }],
        lg:   ['16px', { lineHeight: '24px' }],
        xl:   ['18px', { lineHeight: '28px' }],
        '2xl': ['22px', { lineHeight: '32px' }],
        '3xl': ['28px', { lineHeight: '36px' }],
      },
      boxShadow: {
        card:    '0 1px 3px rgba(15,23,42,0.08), 0 1px 2px rgba(15,23,42,0.06)',
        hover:   '0 4px 12px rgba(15,23,42,0.10)',
        sidebar: '2px 0 8px rgba(15,23,42,0.15)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-over-in': {
          from: { transform: 'translateX(100%)' },
          to:   { transform: 'translateX(0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.4' },
        },
      },
      animation: {
        'fade-in':      'fade-in 200ms ease forwards',
        'slide-in':     'slide-in 150ms ease forwards',
        'slide-over-in': 'slide-over-in 250ms cubic-bezier(0.32,0.72,0,1)',
        shimmer:        'shimmer 1.5s infinite linear',
        pulse:          'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
      },
    },
  },
  plugins: [],
}

export default config
