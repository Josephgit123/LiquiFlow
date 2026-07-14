// NOTE: this file does NOT `import { tokens } from './src/styles/tokens.js'`
// despite that being the obvious single-source-of-truth move — Tailwind
// v3's config loader (jiti-based) fails to resolve a relative ESM import
// of project source here: `node -e "require('./tailwind.config.js')"`
// throws "Cannot read properties of undefined (reading 'sizes')" even
// though the exact same import works fine under plain Node ESM
// (`node -e "import('./src/styles/tokens.js')"` resolves correctly). This
// is a known category of jiti/CJS-interop limitation, not a bug in
// tokens.js. Pragmatic fix: the literal values below are hand-copied from
// tokens.js and MUST be kept in sync with it — tokens.js remains the
// canonical source for every raw-JS consumer (StatusBadge, CurrencyDisplay,
// CountdownTimer, Recharts stroke/fill props); only this config file holds
// a second, manually-synced copy, and only because the tooling forces it.

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    // Fully replaces (not extends) Tailwind's default type scale — Master
    // Specification Section 19 mandates exactly these 5 steps, no
    // arbitrary in-between sizes. A page reaching for text-2xl/text-lg/etc.
    // will simply get no matching utility, by design.
    fontSize: {
      xs: '12px',
      sm: '14px',
      base: '16px',
      lg: '24px',
      xl: '36px',
    },
    extend: {
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      colors: {
        canvas: {
          light: '#F8FAFC', // Slate 50
          dark: '#09090B', // Zinc 950
        },
        surface: {
          light: '#FFFFFF',
          'light-elevated': '#F1F5F9', // Slate 100
          dark: '#18181B', // Zinc 900
          'dark-elevated': '#27272A', // Zinc 800
        },
        'border-token': {
          light: 'rgba(15, 23, 42, 0.08)',
          dark: 'rgba(250, 250, 250, 0.08)',
        },
        ink: {
          'primary-light': '#0F172A', // Slate 900
          'secondary-light': '#475569', // Slate 600
          'muted-light': '#94A3B8', // Slate 400
          'primary-dark': '#FAFAFA', // Zinc 50
          'secondary-dark': '#A1A1AA', // Zinc 400
          'muted-dark': '#71717A', // Zinc 500
        },
        accent: {
          reserve: '#F59E0B', // Amber 500
          liquid: '#06B6D4', // Cyan 500
          alert: '#EF4444', // Red 500
        },
      },
      // Tailwind's default rounded-2xl is already exactly 1rem (16px) —
      // the spec's required panel radius — so no override is needed
      // there. This app must use rounded-2xl exclusively; never mix in
      // rounded-lg/rounded-xl on cards/panels.
      backdropBlur: {
        md: '12px',
      },
    },
  },
  plugins: [],
};
