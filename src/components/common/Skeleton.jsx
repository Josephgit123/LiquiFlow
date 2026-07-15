// Generic loading placeholder — extracted from the pulsing skeleton divs
// that were previously hand-rolled per page (DataTable's skeleton rows,
// ad hoc `animate-pulse` divs). `variant` picks the shape; `width`/`height`
// accept any CSS size value (Tailwind arbitrary values don't cover every
// case a caller needs here, e.g. a stat tile's exact number width).
const VARIANT_CLASSES = {
  text: 'rounded',
  circle: 'rounded-full',
  rect: 'rounded-xl',
};

export default function Skeleton({ variant = 'text', width = '100%', height = '1em', className = '' }) {
  return (
    <span
      role="presentation"
      aria-hidden="true"
      className={`inline-block animate-pulse bg-black/5 dark:bg-white/10 ${VARIANT_CLASSES[variant]} ${className}`}
      style={{ width, height }}
    />
  );
}
