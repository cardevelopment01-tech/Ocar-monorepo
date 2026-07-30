import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#F5F7FF',
        surface: '#FFFFFF',
        'surface-2': '#F8FAFF',
        primary: {
          DEFAULT: '#0A9FB0',
          dark: '#087C89',
          bright: '#22B8C9',
          light: '#B8E9EE',
          subtle: '#E4F8FA',
        },
        accent: {
          DEFAULT: '#DC3E93',
          light: '#FBE0EE',
        },
        money: {
          DEFAULT: '#059669',
          light: '#D1FAE5',
        },
        text: {
          primary: '#0F172A',
          secondary: '#475569',
          muted: '#94A3B8',
          inverse: '#FFFFFF',
        },
        border: {
          DEFAULT: '#E8EEFF',
          light: '#F1F5FF',
        },
        status: {
          success: '#10B981',
          warning: '#F59E0B',
          error: '#EF4444',
          info: '#0EA5E9',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        '2xl': '24px',
        '3xl': '32px',
        full: '9999px',
      },
      boxShadow: {
        card: '0 2px 16px rgba(10, 159, 176, 0.07)',
        sheet: '0 -6px 32px rgba(10, 159, 176, 0.10)',
        button: '0 4px 20px rgba(10, 159, 176, 0.40)',
        'button-press': '0 2px 10px rgba(10, 159, 176, 0.32)',
        float: '0 4px 20px rgba(10, 159, 176, 0.12)',
        glow: '0 6px 32px rgba(10, 159, 176, 0.35)',
        topbar: '0 1px 0 rgba(10, 159, 176, 0.08)',
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #0A9FB0 0%, #DC3E93 100%)',
        'gradient-primary-soft': 'linear-gradient(135deg, #22B8C9 0%, #E869B3 100%)',
      },
      animation: {
        'slide-up': 'slideUp 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        'slide-down': 'slideDown 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        'fade-in': 'fadeIn 0.2s ease-out',
        'scale-in': 'scaleIn 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'fade-up': 'fadeUp 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        slideUp: {
          from: { transform: 'translateY(100%)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          from: { transform: 'translateY(-20px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          from: { transform: 'scale(0.9)', opacity: '0' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
    },
  },
  plugins: [],
}

export default config
