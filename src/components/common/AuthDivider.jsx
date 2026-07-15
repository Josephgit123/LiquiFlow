// The "or" divider between an email/password form and the Google button —
// duplicated verbatim in MerchantLogin.jsx and MerchantRegister.jsx.
export default function AuthDivider({ label = 'or' }) {
  return (
    <div className="flex items-center gap-3 text-xs text-ink-muted-light dark:text-ink-muted-dark">
      <div className="h-px flex-1 bg-border-token-light dark:bg-border-token-dark" />
      {label}
      <div className="h-px flex-1 bg-border-token-light dark:bg-border-token-dark" />
    </div>
  );
}
