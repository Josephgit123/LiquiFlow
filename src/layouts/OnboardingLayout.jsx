import { Outlet } from 'react-router-dom';
import ThemeToggle from '../components/common/ThemeToggle.jsx';

// Full-screen overlay, deliberately WITHOUT Sidebar/full Topbar — Master
// Specification Section 5 describes onboarding as a full-screen wizard,
// not a sidebar-nested page. It previously lived inside MerchantLayout
// (with a persistent sidebar showing the very pages the onboarding gate
// blocks access to), which contradicted the spec; this is a dedicated
// layout instead. Wider than AuthLayout's centered card, since the wizard
// needs room for a multi-step horizontal progress flow. Still includes
// ThemeToggle directly (no full Topbar) — Part 1 requires it reachable
// from every layout, with no exception for standalone ones.
export default function OnboardingLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas-light px-4 text-ink-primary-light dark:bg-canvas-dark dark:text-ink-primary-dark">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-3xl rounded-2xl border border-border-token-light bg-surface-light p-8 shadow-sm dark:border-border-token-dark dark:bg-surface-dark">
        <Outlet />
      </div>
    </div>
  );
}
