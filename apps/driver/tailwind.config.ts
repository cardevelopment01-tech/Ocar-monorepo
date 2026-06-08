import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:        '#0A0C10',
        surface:   '#12151C',
        'surface-2': '#1A1E28',
        'surface-3': '#222736',
        primary: {
          DEFAULT: '#22C55E',
          dark:    '#16A34A',
          light:   '#DCFCE7',
          subtle:  '#052E16',
        },
        accent: {
          blue:   '#3B82F6',
          amber:  '#F59E0B',
          red:    '#EF4444',
          purple: '#A855F7',
        },
        text: {
          primary:   '#F1F5F9',
          secondary: '#94A3B8',
          muted:     '#475569',
          inverse:   '#0A0C10',
        },
        border: {
          DEFAULT: '#1E2433',
          light:   '#2D3548',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
      },
      borderRadius: {
        sm:   '8px',
        md:   '12px',
        lg:   '16px',
        xl:   '20px',
        '2xl': '24px',
        '3xl': '32px',
        full: '9999px',
      },
      boxShadow: {
        card:   '0 2px 12px rgba(0, 0, 0, 0.4)',
        green:  '0 0 20px rgba(34, 197, 94, 0.15)',
        sheet:  '0 -4px 24px rgba(0, 0, 0, 0.5)',
        button: '0 2px 12px rgba(34, 197, 94, 0.3)',
        red:    '0 0 20px rgba(239, 68, 68, 0.15)',
      },
      animation: {
        'pulse-green':  'pulseGreen 2s ease-in-out infinite',
        'ring-expand':  'ringExpand 1.5s ease-out infinite',
        'slide-up':     'slideUp 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in':      'fadeIn 0.2s ease-out',
        'pulse-soft':   'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        pulseGreen: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(34, 197, 94, 0.15)' },
          '50%':      { boxShadow: '0 0 40px rgba(34, 197, 94, 0.4)' },
        },
        ringExpand: {
          '0%':   { transform: 'scale(1)', opacity: '0.6' },
          '100%': { transform: 'scale(1.8)', opacity: '0' },
        },
        slideUp: {
          from: { transform: 'translateY(100%)', opacity: '0' },
          to:   { transform: 'translateY(0)',    opacity: '1' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' },
        },
      },
    },
  },
  plugins: [],
}

export default config
