export default function PageStub({ title, description }) {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-2 p-8">
      <h1 className="text-lg font-semibold text-ink-primary-light dark:text-ink-primary-dark">
        {title}
      </h1>
      {description && (
        <p className="max-w-xl text-sm text-ink-muted-light dark:text-ink-muted-dark">
          {description}
        </p>
      )}
      <span className="mt-4 rounded-full bg-surface-light-elevated px-3 py-1 text-xs font-medium text-ink-muted-light dark:bg-surface-dark-elevated dark:text-ink-muted-dark">
        Scaffolded — content pending
      </span>
    </div>
  );
}
