import { Outlet } from 'react-router-dom';
import Sidebar from '../components/common/Sidebar.jsx';
import Topbar from '../components/common/Topbar.jsx';

// TODO: guard this layout with requireAdminAuth-equivalent client check
// (admin JWT presence/validity) — isolated from merchant Firebase Auth
// per CLAUDE.md invariant #7. Real check happens server-side regardless.
export default function AdminLayout() {
  return (
    <div className="flex h-screen bg-canvas-light text-ink-primary-light dark:bg-canvas-dark dark:text-ink-primary-dark">
      <Sidebar role="ADMIN" />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar title="Administrative Workspace" />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
