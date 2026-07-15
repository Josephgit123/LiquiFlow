import { useId } from 'react';

// ONE text input implementation — replaces ~15 hand-rolled, near-identical
// className strings across pages (same audit pass as Button.jsx). Adds a
// visible focus-visible ring and an optional inline error message with
// aria-invalid/aria-describedby wiring, neither of which any page had
// before (form errors were shown as a separate paragraph with no
// programmatic link back to the field for assistive tech).
export default function Input({ label, error, id, className = '', ...rest }) {
  const reactId = useId();
  const inputId = id || reactId;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <label className="flex flex-col gap-1.5 text-sm" htmlFor={inputId}>
      {label && <span className="font-medium">{label}</span>}
      <input
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={errorId}
        className={`rounded-lg border bg-surface-light px-3 py-2 text-sm outline-none transition focus:border-accent-liquid focus-visible:ring-2 focus-visible:ring-accent-liquid/30 dark:bg-surface-dark ${
          error
            ? 'border-accent-alert focus:border-accent-alert focus-visible:ring-accent-alert/30'
            : 'border-border-token-light dark:border-border-token-dark'
        } ${className}`}
        {...rest}
      />
      {error && (
        <span id={errorId} className="text-xs text-accent-alert">
          {error}
        </span>
      )}
    </label>
  );
}
