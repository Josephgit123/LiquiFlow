import ThemeToggle from './ThemeToggle.jsx';

// `onMenuClick`, if provided, renders a hamburger button visible only
// below `md` — PublicLayout (no sidebar to open) omits it and gets no
// button; MerchantLayout/AdminLayout (via AppShell) always pass it.
export default function Topbar({ title, onMenuClick }) {
  return (
    <header className="flex items-center justify-between border-b border-border-token-light bg-surface-light/70 px-4 py-4 backdrop-blur-md print:hidden sm:px-6 dark:border-border-token-dark dark:bg-surface-dark/70">
      <div className="flex items-center gap-3">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            className="-ml-1.5 rounded-lg p-1.5 text-ink-secondary-light transition hover:bg-surface-light-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50 md:hidden dark:text-ink-secondary-dark dark:hover:bg-surface-dark-elevated"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <h2 className="text-base font-medium text-ink-primary-light sm:text-lg dark:text-ink-primary-dark">
          {title}
        </h2>
      </div>
      <ThemeToggle />
    </header>
  );
}
