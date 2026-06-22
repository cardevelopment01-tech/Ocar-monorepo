import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:          '#F5F8FF',
        surface:     '#FFFFFF',
        'surface-2': '#F0F4FD',
        'surface-3': '#E8EEFA',
        primary: {
          DEFAULT: '#1E293B',
          dark:    '#0F172A',
          light:   '#F1F5F9',
          subtle:  '#F8FAFC',
        },
        accent: {
          orange:         '#F97316',
          'orange-light': '#FFF7ED',
          red:            '#EF4444',
          green:          '#22C55E',
          amber:          '#F59E0B',
          purple:         '#8B5CF6',
          blue:           '#3B82F6',
        },
        text: {
          primary:   '#0F172A',
          secondary: '#475569',
          muted:     '#94A3B8',
          inverse:   '#FFFFFF',
        },
        border: {
          DEFAULT: '#E2E8F0',
          light:   '#F1F5F9',
        },
      },
      fontFamily: {
        sans:    ['Inter', 'sans-serif'],
        display: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        sm:    '8px',
        md:    '12px',
        lg:    '16px',
        xl:    '20px',
        '2xl': '24px',
        '3xl': '32px',
        full:  '9999px',
      },
      boxShadow: {
        card:            '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.07)',
        'card-lg':       '0 2px 8px rgba(15,23,42,0.06), 0 8px 32px rgba(15,23,42,0.08)',
        blue:            '0 0 24px rgba(30,41,59,0.18)',
        orange:          '0 0 24px rgba(249,115,22,0.22)',
        green:           '0 0 20px rgba(34,197,94,0.18)',
        sheet:           '0 -4px 32px rgba(15,23,42,0.10)',
        button:          '0 4px 14px rgba(15,23,42,0.30)',
        'button-hover':  '0 6px 22px rgba(15,23,42,0.38)',
        'button-orange': '0 4px 14px rgba(249,115,22,0.35)',
        topbar:          '0 1px 0 rgba(15,23,42,0.06)',
        nav:             '0 -1px 0 rgba(15,23,42,0.06)',
        red:             '0 0 16px rgba(239,68,68,0.18)',
      },
      animation: {
        'pulse-orange': 'pulseOrange 2s ease-in-out infinite',
        'pulse-green':  'pulseOrange 2s ease-in-out infinite', // alias
        'ring-expand':  'ringExpand 2s ease-out infinite',
        'slide-up':     'slideUp 0.32s cubic-bezier(0.22,1,0.36,1)',
        'fade-in':      'fadeIn 0.22s ease-out',
        'fade-up':      'fadeUp 0.28s cubic-bezier(0.22,1,0.36,1)',
        'pulse-soft':   'pulseSoft 2.4s ease-in-out infinite',
        shimmer:        'shimmer 1.6s infinite linear',
      },
      keyframes: {
        pulseOrange: {
          '0%, 100%': { boxShadow: '0 0 16px rgba(249,115,22,0.12)' },
          '50%':      { boxShadow: '0 0 32px rgba(249,115,22,0.38)' },
        },
        ringExpand: {
          '0%':   { transform: 'scale(1)',   opacity: '0.40' },
          '100%': { transform: 'scale(2.2)', opacity: '0'   },
        },
        slideUp: {
          from: { transform: 'translateY(100%)', opacity: '0' },
          to:   { transform: 'translateY(0)',    opacity: '1' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to:   { opacity: '1', transform: 'translateY(0)'    },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1'    },
          '50%':      { opacity: '0.45' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0'  },
        },
      },
    },
  },
  plugins: [],
}

export default config
