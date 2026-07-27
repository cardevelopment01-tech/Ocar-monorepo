import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      backgroundImage: {
        brand: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
      },
      colors: {
        // Sidebar (white/light, premium SaaS style)
        sidebar:               '#FFFFFF',
        'sidebar-hover':       '#F5F7FF',
        'sidebar-active':      '#4F46E5',
        'sidebar-border':      '#E8EAFF',
        'sidebar-text':        '#5B6B85',
        'sidebar-active-text': '#FFFFFF',
        // Canvas & surfaces
        canvas:      '#F8FAFF',
        surface:     '#FFFFFF',
        'surface-2': '#F5F7FF',
        'surface-3': '#EEF0FF',
        // Brand (indigo, premium, modern, tech)
        primary:         '#4F46E5',
        'primary-dark':  '#4338CA',
        'primary-light': '#EEF2FF',
        // Warm accent (cab/transport)
        accent:         '#F97316',
        'accent-light': '#FFF7ED',
        // Semantic
        success:         '#10B981',
        'success-light': '#D1FAE5',
        warning:         '#F59E0B',
        'warning-light': '#FEF3C7',
        danger:          '#EF4444',
        'danger-light':  '#FEE2E2',
        info:            '#0EA5E9',
        'info-light':    '#E0F2FE',
        purple:          '#8B5CF6',
        'purple-light':  '#EDE9FE',
        // Text
        'text-primary':   '#0F172A',
        'text-secondary': '#475569',
        'text-muted':     '#5B6B85',
        'text-inverse':   '#FFFFFF',
        // Borders
        border:        '#E2E8F0',
        'border-light': '#F1F5F9',
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
      },
      fontSize: {
        xs:    ['11px', { lineHeight: '16px' }],
        sm:    ['12px', { lineHeight: '18px' }],
        base:  ['13px', { lineHeight: '20px' }],
        md:    ['14px', { lineHeight: '22px' }],
        lg:    ['16px', { lineHeight: '24px' }],
        xl:    ['18px', { lineHeight: '28px' }],
        '2xl': ['22px', { lineHeight: '32px' }],
        '3xl': ['28px', { lineHeight: '36px' }],
      },
      boxShadow: {
        card:         '0 1px 3px rgba(15,23,42,0.05), 0 4px 20px rgba(79,70,229,0.06)',
        'card-hover': '0 4px 16px rgba(15,23,42,0.08), 0 12px 40px rgba(79,70,229,0.12)',
        hover:        '0 8px 30px rgba(79,70,229,0.18)',
        sidebar:      '1px 0 0 #E8EAFF',
        topbar:       '0 1px 0 #E8EAFF, 0 4px 20px rgba(79,70,229,0.05)',
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
        'fade-in':       'fade-in 200ms ease forwards',
        'slide-in':      'slide-in 150ms ease forwards',
        'slide-over-in': 'slide-over-in 250ms cubic-bezier(0.32,0.72,0,1)',
        shimmer:         'shimmer 1.5s infinite linear',
        pulse:           'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
      },
    },
  },
  plugins: [],
}

export default config
