import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MERCHANT_NAV, ADMIN_NAV } from '../../routes/navConfig.js';

function NavItems({ items, onNavigate }) {
  return (
    <>
      {items.map((item) => (
        <NavLink
          key={item.id}
          to={item.path}
          onClick={onNavigate}
          className={({ isActive }) =>
            `rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50 ${
              isActive
                ? 'bg-ink-primary-light text-surface-light dark:bg-ink-primary-dark dark:text-surface-dark'
                : 'text-ink-secondary-light hover:bg-surface-light-elevated dark:text-ink-secondary-dark dark:hover:bg-surface-dark-elevated'
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </>
  );
}

// Previously a fixed `w-64` column with no breakpoint variant at all —
// below `md` it just permanently ate ~256px of a 375px viewport (Groups
// 1-5 audit, high severity). Now a persistent column at `md`+ and an
// off-canvas drawer (toggled from Topbar's hamburger, via AppShell's
// `mobileOpen` state) below it.
export default function Sidebar({ role, mobileOpen = false, onCloseMobile }) {
  const items = role === 'ADMIN' ? ADMIN_NAV : MERCHANT_NAV;

  return (
    <>
      <nav className="hidden h-full w-64 flex-col gap-1 border-r border-border-token-light bg-surface-light/70 p-4 backdrop-blur-md print:hidden md:flex dark:border-border-token-dark dark:bg-surface-dark/70">
        <span className="mb-4 px-2 text-lg font-semibold text-ink-primary-light dark:text-ink-primary-dark">
          LiquiFlow
        </span>
        <NavItems items={items} />
      </nav>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={onCloseMobile}
              aria-hidden="true"
            />
            <motion.nav
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-1 bg-surface-light p-4 shadow-xl md:hidden dark:bg-surface-dark"
              aria-label="Navigation"
            >
              <span className="mb-4 px-2 text-lg font-semibold text-ink-primary-light dark:text-ink-primary-dark">
                LiquiFlow
              </span>
              <NavItems items={items} onNavigate={onCloseMobile} />
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
