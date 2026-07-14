// Single source of truth for both the sidebar and the router.
// Every route in the app must be listed here — do not hand-add routes
// anywhere else (see CLAUDE.md / PROJECT_STRUCTURE.md).
//
// Reconciled against the Master Specification's 27-page manifest
// (Phase 4 session) — decisions made explicitly, not guessed:
//   - Settlement Ledger stays ONE merged page covering both the spec's
//     "Settlement Ledger" and "Transactions" pages.
//   - Risk Profile Monitor (merchant's own risk-tier view) and a NEW
//     Analytics page (volume/forecast charts) are kept as two DISTINCT
//     pages, not merged.
//   - Fee Structure Panel was renamed/expanded to PlatformSettings,
//     covering the full PUT /api/admin/settings body (fee %, vault
//     maturity days, maintenance mode) — no separate settings page.
//   - ComplianceVerification and DatabaseBackupDashboard were REMOVED —
//     no backend exists for either and none is planned; keeping them
//     would mean inventing a subsystem. ApiKeysWebhooks/
//     WebhookDispatchRegistry (still-scaffolded /api/webhooks) and
//     SystemHealthStatus (real GET /api/health) were kept.
//   - Notifications (merchant), Refund Queue / Settlement Engine /
//     Analytics (admin) were ADDED — they had real backend support
//     (Steps 14-15) but no nav entry at all.

// `layout` picks which shell wraps the page: 'public' (PublicLayout) or
// 'auth' (AuthLayout, the centered card used for sign-in/sign-up forms).
export const PUBLIC_ROUTES = [
  { id: 'LandingPage', path: '/', label: 'Home', icon: 'home', layout: 'public' },
  { id: 'MerchantLogin', path: '/login', label: 'Merchant Login', icon: 'login', layout: 'auth' },
  { id: 'MerchantRegister', path: '/register', label: 'Merchant Register', icon: 'user-plus', layout: 'auth' },
  { id: 'AdminLogin', path: '/admin/login', label: 'Admin Login', icon: 'shield', layout: 'auth' },
  { id: 'NotFound', path: '*', label: 'Not Found', icon: 'alert', layout: 'public' },
];

// Requires merchant auth, but deliberately NOT wrapped in MerchantLayout's
// sidebar/topbar — Master Specification Section 5 describes onboarding as
// a full-screen wizard. Rendered via OnboardingLayout instead.
export const MERCHANT_STANDALONE_ROUTES = [
  { id: 'OnboardingWizard', path: '/merchant/onboarding', label: 'Onboarding Wizard', icon: 'flag' },
];

// 12 merchant sidebar views, gated by the onboarding gate
// (accountStatus === 'ACTIVE') for everything except onboarding itself
// (CLAUDE.md invariant #4).
export const MERCHANT_NAV = [
  { id: 'CoreCommandDashboard', path: '/merchant/dashboard', label: 'Core Command Dashboard', icon: 'layout-dashboard', role: 'MERCHANT' },
  { id: 'SettlementLedger', path: '/merchant/transactions', label: 'Settlement Ledger', icon: 'list', role: 'MERCHANT' },
  { id: 'TransactionSandbox', path: '/merchant/sandbox', label: 'Transaction Sandbox', icon: 'flask', role: 'MERCHANT' },
  { id: 'MaturityVaultInterface', path: '/merchant/vault', label: 'Maturity Vault Interface', icon: 'lock', role: 'MERCHANT' },
  { id: 'RiskProfileMonitor', path: '/merchant/risk-profile', label: 'Risk Profile Monitor', icon: 'gauge', role: 'MERCHANT' },
  { id: 'MerchantAnalytics', path: '/merchant/analytics', label: 'Analytics', icon: 'bar-chart', role: 'MERCHANT' },
  { id: 'RefundLifecycleHub', path: '/merchant/refunds', label: 'Refund Lifecycle Hub', icon: 'rotate-ccw', role: 'MERCHANT' },
  { id: 'NotificationsFeed', path: '/merchant/notifications', label: 'Notifications', icon: 'bell', role: 'MERCHANT' },
  { id: 'LinkedFundingSettings', path: '/merchant/funding', label: 'Linked Funding Settings', icon: 'link', role: 'MERCHANT' },
  { id: 'ApiKeysWebhooks', path: '/merchant/webhooks', label: 'API Keys & Webhooks', icon: 'key', role: 'MERCHANT' },
  { id: 'SystemHealthStatus', path: '/merchant/system-health', label: 'System Health Status', icon: 'activity', role: 'MERCHANT' },
  { id: 'SupportDesk', path: '/merchant/support', label: 'Support Desk', icon: 'life-buoy', role: 'MERCHANT' },
];

// 12 admin views, gated by requireAdminAuth (CLAUDE.md invariant #7).
export const ADMIN_NAV = [
  { id: 'GlobalSystemsMaster', path: '/admin/dashboard', label: 'Global Systems Master', icon: 'layout-dashboard', role: 'ADMIN' },
  { id: 'MerchantDirectoryConsole', path: '/admin/merchants', label: 'Merchant Directory Console', icon: 'users', role: 'ADMIN' },
  { id: 'RiskMatrixConfigurator', path: '/admin/risk-matrix', label: 'Risk Matrix Configurator', icon: 'sliders', role: 'ADMIN' },
  { id: 'TieringAllocationControl', path: '/admin/tiering', label: 'Tiering Allocation Control', icon: 'layers', role: 'ADMIN' },
  { id: 'RefundQueue', path: '/admin/refunds', label: 'Refund Queue', icon: 'inbox', role: 'ADMIN' },
  { id: 'SettlementEngine', path: '/admin/settlements', label: 'Settlement Engine', icon: 'banknote', role: 'ADMIN' },
  { id: 'ChargebackDisputeSimulator', path: '/admin/chargebacks', label: 'Chargeback Dispute Simulator', icon: 'alert-triangle', role: 'ADMIN' },
  { id: 'SupportEscalationDesk', path: '/admin/support', label: 'Support Escalation Desk', icon: 'life-buoy', role: 'ADMIN' },
  { id: 'AuditTrailExplorer', path: '/admin/audit-logs', label: 'Audit Trail Explorer', icon: 'file-search', role: 'ADMIN' },
  { id: 'AdminAnalytics', path: '/admin/analytics', label: 'Analytics', icon: 'bar-chart', role: 'ADMIN' },
  { id: 'WebhookDispatchRegistry', path: '/admin/webhooks', label: 'Webhook Dispatch Registry', icon: 'radio', role: 'ADMIN' },
  { id: 'PlatformSettings', path: '/admin/settings', label: 'Platform Settings', icon: 'settings', role: 'ADMIN' },
];
