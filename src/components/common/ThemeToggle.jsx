import { useTheme } from '../../context/ThemeContext.jsx';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle color theme"
      className="rounded-full border border-border-token-light px-3 py-1.5 text-sm text-ink-secondary-light transition hover:bg-surface-light-elevated dark:border-border-token-dark dark:text-ink-secondary-dark dark:hover:bg-surface-dark-elevated"
    >
      {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
    </button>
  );
}
