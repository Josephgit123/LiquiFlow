// Single source of truth for color (Master Specification Section 19).
// Every page/component must consume these — never hardcode a hex value in
// a page component. Two consumption paths:
//   1. Tailwind utility classes — tailwind.config.js imports `tokens` and
//      spreads it into theme.extend.colors (e.g. bg-canvas-dark,
//      text-accent-liquid, border-accent-reserve/30).
//   2. Raw JS — anywhere a hex string is required directly (Recharts
//      stroke/fill props, an SVG countdown ring, StatusBadge's color map)
//      import `tokens` directly instead of a Tailwind class.
//
// Anchors are exactly the three spec'd accents plus the two canvas colors
// — every other color below is a derived light/dark neutral (Zinc for
// dark mode, Slate for light mode, matching the two canvas anchors), not
// an invented, unrelated palette.
export const tokens = {
  canvas: {
    dark: '#09090B', // Zinc 950
    light: '#F8FAFC', // Slate 50
  },

  // Card/panel surfaces, one step up from canvas in each mode.
  surface: {
    dark: '#18181B', // Zinc 900
    darkElevated: '#27272A', // Zinc 800
    light: '#FFFFFF',
    lightElevated: '#F1F5F9', // Slate 100
  },

  border: {
    dark: 'rgba(250, 250, 250, 0.08)',
    light: 'rgba(15, 23, 42, 0.08)',
  },

  text: {
    primaryDark: '#FAFAFA', // Zinc 50
    secondaryDark: '#A1A1AA', // Zinc 400
    mutedDark: '#71717A', // Zinc 500
    primaryLight: '#0F172A', // Slate 900
    secondaryLight: '#475569', // Slate 600
    mutedLight: '#94A3B8', // Slate 400
  },

  // The three spec'd accents — the ONLY accent hues in this system.
  accent: {
    reserve: '#F59E0B', // Amber 500 — locked/reserve funds, vault countdowns, pending states
    liquid: '#06B6D4', // Cyan 500 — available/liquid funds, success states
    alert: '#EF4444', // Red 500 — disputes, chargebacks, suspensions, destructive actions, negative balances
  },
};

// Semantic status -> accent mapping, so every StatusBadge/chart/badge in
// the app agrees on what a given enum value looks like, instead of five
// ad hoc badge implementations picking their own colors.
export const statusColor = {
  // /transactions.status
  CAPTURED: 'liquid',
  REFUNDED: 'neutral',
  DISPUTED: 'alert',
  // /tickets.status
  OPEN: 'reserve',
  PENDING: 'reserve',
  RESOLVED: 'neutral',
  // /merchants.accountStatus
  ACTIVE: 'liquid',
  SUSPENDED: 'alert',
  // risk tier (currentRiskTier / effectiveTier)
  LOW: 'liquid',
  MEDIUM: 'reserve',
  HIGH: 'alert',
  // /reserve_vault.isMatured, derived client-side (not a literal DB field
  // named "status") — MATURED means released into availableLiquid (a
  // liquid/good-state signal), LOCKED means still held in reserve.
  MATURED: 'liquid',
  LOCKED: 'reserve',
};

export const radii = {
  card: '1rem', // 16px, rounded-2xl — the ONLY panel radius used anywhere
};

export const spacingUnit = 8; // px — every margin/padding/gap is a multiple of this

export const typography = {
  fontFamily: '"Inter", system-ui, sans-serif',
  sizes: {
    xs: '12px',
    sm: '14px',
    base: '16px',
    lg: '24px',
    xl: '36px',
  },
};
