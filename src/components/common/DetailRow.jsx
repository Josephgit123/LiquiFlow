// A single label/value row, used in detail panels and inspect modals
// (Settlement Ledger, Refund Hub, and future pages needing the same
// pattern) — one implementation instead of each page re-declaring it.
// `last:border-b-0` drops the trailing divider before a modal's padding
// instead of every row unconditionally drawing one.
export default function DetailRow({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between border-b border-border-token-light/50 pb-2 last:border-b-0 last:pb-0 dark:border-border-token-dark/50">
      <span className="text-ink-muted-light dark:text-ink-muted-dark">{label}</span>
      <span className={mono ? 'font-mono text-xs' : 'font-medium'}>{value}</span>
    </div>
  );
}
