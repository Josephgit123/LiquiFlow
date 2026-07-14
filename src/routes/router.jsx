import { Routes, Route } from 'react-router-dom';
import { PUBLIC_ROUTES, MERCHANT_STANDALONE_ROUTES, MERCHANT_NAV, ADMIN_NAV } from './navConfig.js';

import PublicLayout from '../layouts/PublicLayout.jsx';
import AuthLayout from '../layouts/AuthLayout.jsx';
import OnboardingLayout from '../layouts/OnboardingLayout.jsx';
import MerchantLayout from '../layouts/MerchantLayout.jsx';
import AdminLayout from '../layouts/AdminLayout.jsx';

import LandingPage from '../pages/public/LandingPage.jsx';
import MerchantLogin from '../pages/public/MerchantLogin.jsx';
import MerchantRegister from '../pages/public/MerchantRegister.jsx';
import AdminLogin from '../pages/public/AdminLogin.jsx';
import NotFound from '../pages/public/NotFound.jsx';

import OnboardingWizard from '../pages/merchant/OnboardingWizard.jsx';

import CoreCommandDashboard from '../pages/merchant/CoreCommandDashboard.jsx';
import SettlementLedger from '../pages/merchant/SettlementLedger.jsx';
import TransactionSandbox from '../pages/merchant/TransactionSandbox.jsx';
import MaturityVaultInterface from '../pages/merchant/MaturityVaultInterface.jsx';
import RiskProfileMonitor from '../pages/merchant/RiskProfileMonitor.jsx';
import MerchantAnalytics from '../pages/merchant/MerchantAnalytics.jsx';
import RefundLifecycleHub from '../pages/merchant/RefundLifecycleHub.jsx';
import NotificationsFeed from '../pages/merchant/NotificationsFeed.jsx';
import LinkedFundingSettings from '../pages/merchant/LinkedFundingSettings.jsx';
import ApiKeysWebhooks from '../pages/merchant/ApiKeysWebhooks.jsx';
import SystemHealthStatus from '../pages/merchant/SystemHealthStatus.jsx';
import SupportDesk from '../pages/merchant/SupportDesk.jsx';

import GlobalSystemsMaster from '../pages/admin/GlobalSystemsMaster.jsx';
import MerchantDirectoryConsole from '../pages/admin/MerchantDirectoryConsole.jsx';
import RiskMatrixConfigurator from '../pages/admin/RiskMatrixConfigurator.jsx';
import TieringAllocationControl from '../pages/admin/TieringAllocationControl.jsx';
import RefundQueue from '../pages/admin/RefundQueue.jsx';
import SettlementEngine from '../pages/admin/SettlementEngine.jsx';
import ChargebackDisputeSimulator from '../pages/admin/ChargebackDisputeSimulator.jsx';
import SupportEscalationDesk from '../pages/admin/SupportEscalationDesk.jsx';
import AuditTrailExplorer from '../pages/admin/AuditTrailExplorer.jsx';
import AdminAnalytics from '../pages/admin/AdminAnalytics.jsx';
import WebhookDispatchRegistry from '../pages/admin/WebhookDispatchRegistry.jsx';
import PlatformSettings from '../pages/admin/PlatformSettings.jsx';

// Maps navConfig `id` -> actual page component. Every id in navConfig.js
// must have an entry here; router.jsx is the only file that imports pages.
const PUBLIC_PAGES = {
  LandingPage,
  MerchantLogin,
  MerchantRegister,
  AdminLogin,
  NotFound,
};

const MERCHANT_STANDALONE_PAGES = {
  OnboardingWizard,
};

const MERCHANT_PAGES = {
  CoreCommandDashboard,
  SettlementLedger,
  TransactionSandbox,
  MaturityVaultInterface,
  RiskProfileMonitor,
  MerchantAnalytics,
  RefundLifecycleHub,
  NotificationsFeed,
  LinkedFundingSettings,
  ApiKeysWebhooks,
  SystemHealthStatus,
  SupportDesk,
};

const ADMIN_PAGES = {
  GlobalSystemsMaster,
  MerchantDirectoryConsole,
  RiskMatrixConfigurator,
  TieringAllocationControl,
  RefundQueue,
  SettlementEngine,
  ChargebackDisputeSimulator,
  SupportEscalationDesk,
  AuditTrailExplorer,
  AdminAnalytics,
  WebhookDispatchRegistry,
  PlatformSettings,
};

export default function Router() {
  const publicRoutes = PUBLIC_ROUTES.filter((r) => r.layout === 'public');
  const authRoutes = PUBLIC_ROUTES.filter((r) => r.layout === 'auth');

  return (
    <Routes>
      <Route element={<PublicLayout />}>
        {publicRoutes.map((route) => {
          const Page = PUBLIC_PAGES[route.id];
          return <Route key={route.id} path={route.path} element={<Page />} />;
        })}
      </Route>

      <Route element={<AuthLayout />}>
        {authRoutes.map((route) => {
          const Page = PUBLIC_PAGES[route.id];
          return <Route key={route.id} path={route.path} element={<Page />} />;
        })}
      </Route>

      {/* Standalone merchant routes (full-screen, no sidebar) — declared as
          their own top-level Routes, sibling to (not nested inside) the
          /merchant MerchantLayout group below, so they never inherit the
          sidebar/topbar chrome. */}
      <Route element={<OnboardingLayout />}>
        {MERCHANT_STANDALONE_ROUTES.map((route) => {
          const Page = MERCHANT_STANDALONE_PAGES[route.id];
          return <Route key={route.id} path={route.path} element={<Page />} />;
        })}
      </Route>

      <Route path="/merchant" element={<MerchantLayout />}>
        {MERCHANT_NAV.map((route) => {
          const Page = MERCHANT_PAGES[route.id];
          return (
            <Route
              key={route.id}
              path={route.path.replace('/merchant/', '')}
              element={<Page />}
            />
          );
        })}
      </Route>

      <Route path="/admin" element={<AdminLayout />}>
        {ADMIN_NAV.map((route) => {
          const Page = ADMIN_PAGES[route.id];
          return (
            <Route
              key={route.id}
              path={route.path.replace('/admin/', '')}
              element={<Page />}
            />
          );
        })}
      </Route>
    </Routes>
  );
}
