import { Outlet } from 'react-router-dom';
import Sidebar from '../components/common/Sidebar.jsx';
import Topbar from '../components/common/Topbar.jsx';

// TODO: guard this layout with the onboarding gate — merchants whose
// accountStatus !== 'ACTIVE' must be blocked from analytics/sandbox views
// at the route level (CLAUDE.md invariant #4), not just hidden in the UI.
export default function MerchantLayout() {
  return (
    <div className="flex h-screen bg-canvas-light text-ink-primary-light dark:bg-canvas-dark dark:text-ink-primary-dark">
      <Sidebar role="MERCHANT" />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar title="Merchant Workspace" />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
