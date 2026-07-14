import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import ThemeToggle from '../components/common/ThemeToggle.jsx';

// AnimatePresence + a pathname key gives Login <-> Register (and any
// future auth-layout route) a genuine animated swap when navigating
// between them — Master Specification Section 5's "animated form swap"
// — rather than each page animating its own mount in isolation with no
// relationship to the page it's replacing. Login.jsx/MerchantRegister.jsx
// each define directional enter/exit motion so the two feel like one
// continuous transition.
//
// ThemeToggle is placed directly here (no Topbar in this layout, even in
// the original Phase 1 scaffold) — Part 1 requires it reachable from
// every layout, with no exception for auth pages.
export default function AuthLayout() {
  const location = useLocation();

  return (
    <div className="relative flex h-screen items-center justify-center bg-canvas-light dark:bg-canvas-dark">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border-token-light bg-surface-light p-8 text-ink-primary-light shadow-sm dark:border-border-token-dark dark:bg-surface-dark dark:text-ink-primary-dark">
        <AnimatePresence mode="wait" initial={false}>
          <Outlet key={location.pathname} />
        </AnimatePresence>
      </div>
    </div>
  );
}
