import { NavLink } from 'react-router-dom';
import { MERCHANT_NAV, ADMIN_NAV } from '../../routes/navConfig.js';

export default function Sidebar({ role }) {
  const items = role === 'ADMIN' ? ADMIN_NAV : MERCHANT_NAV;

  return (
    <nav className="flex h-full w-64 flex-col gap-1 border-r border-border-token-light bg-surface-light/70 p-4 print:hidden dark:border-border-token-dark dark:bg-surface-dark/70">
      <span className="mb-4 px-2 text-lg font-semibold text-ink-primary-light dark:text-ink-primary-dark">
        LiquiFlow
      </span>
      {items.map((item) => (
        <NavLink
          key={item.id}
          to={item.path}
          className={({ isActive }) =>
            `rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive
                ? 'bg-ink-primary-light text-surface-light dark:bg-ink-primary-dark dark:text-surface-dark'
                : 'text-ink-secondary-light hover:bg-surface-light-elevated dark:text-ink-secondary-dark dark:hover:bg-surface-dark-elevated'
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
