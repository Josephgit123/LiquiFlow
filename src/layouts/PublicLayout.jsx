import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import Topbar from '../components/common/Topbar.jsx';
import PageTransition from '../components/common/PageTransition.jsx';

export default function PublicLayout() {
  const location = useLocation();

  return (
    <div className="flex min-h-screen flex-col bg-canvas-light text-ink-primary-light dark:bg-canvas-dark dark:text-ink-primary-dark">
      <Topbar title="LiquiFlow" />
      <main className="flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <PageTransition key={location.pathname}>
            <Outlet />
          </PageTransition>
        </AnimatePresence>
      </main>
    </div>
  );
}
