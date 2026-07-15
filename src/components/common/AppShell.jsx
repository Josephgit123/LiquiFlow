import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import PageTransition from './PageTransition.jsx';
import AiCopilotDrawer from '../ai/AiCopilotDrawer.jsx';

// Sidebar + Topbar + page-transition shell shared by MerchantLayout and
// AdminLayout — previously two near-identical copies differing only in
// `role`/`title` (Groups 1-5 audit). Each caller supplies its own
// auth/onboarding gate as `children` wrapping its `<Outlet/>`.
//
// Also owns the mobile nav-drawer open/close state, since it's the one
// place both Sidebar (the drawer) and Topbar (the button that opens it)
// are both in scope.
export default function AppShell({ role, title, children }) {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen bg-canvas-light text-ink-primary-light dark:bg-canvas-dark dark:text-ink-primary-dark">
      <Sidebar role={role} mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar title={title} onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <PageTransition key={location.pathname}>{children}</PageTransition>
          </AnimatePresence>
        </main>
      </div>
      <AiCopilotDrawer role={role} />
    </div>
  );
}
