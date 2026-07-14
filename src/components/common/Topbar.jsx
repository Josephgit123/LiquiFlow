import ThemeToggle from './ThemeToggle.jsx';

export default function Topbar({ title }) {
  return (
    <header className="flex items-center justify-between border-b border-border-token-light bg-surface-light/70 px-6 py-4 backdrop-blur-md print:hidden dark:border-border-token-dark dark:bg-surface-dark/70">
      <h2 className="text-lg font-medium text-ink-primary-light dark:text-ink-primary-dark">
        {title}
      </h2>
      <ThemeToggle />
    </header>
  );
}
