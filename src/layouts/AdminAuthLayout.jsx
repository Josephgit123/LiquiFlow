import { Outlet } from 'react-router-dom';
import ThemeToggle from '../components/common/ThemeToggle.jsx';

// Deliberately distinct from AuthLayout (Master Specification Section 5:
// admin login must read as "clearly distinct from merchant entry
// designs"). Differences are all visual, not structural:
//   - Fixed deep-charcoal canvas (Zinc 950, the app's own dark-mode
//     anchor) regardless of the light/dark toggle — an ops console, not a
//     theme-following consumer surface. ThemeToggle is still reachable
//     here (Part 1 requires it on every layout with no exception) and
//     still switches the merchant-facing app's stored preference for when
//     an admin navigates back to a merchant/public page, but this
//     specific screen doesn't visually react to it.
//   - Solid opaque card, no backdrop-blur/translucency ("no glassmorphism
//     warmth") — still rounded-2xl (Part 1's radius rule has no
//     exception) and still the 8px spacing grid/Inter type scale, just
//     without the glass treatment.
//   - A thin amber top border as the only accent — reserve/pending-style
//     amber reads as "handle with care," fitting for a privileged
//     credential gate, without introducing a fourth accent color.
export default function AdminAuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas-dark px-4 py-10">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-t-4 border-white/10 border-t-accent-reserve bg-surface-dark p-8 text-ink-primary-dark shadow-2xl">
        <Outlet />
      </div>
    </div>
  );
}
