import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import GlassCard from './GlassCard.jsx';
import Skeleton from './Skeleton.jsx';

/**
 * CLAUDE.md invariant #4: merchants with accountStatus !== 'ACTIVE' must be
 * blocked from dashboard/analytics/sandbox at the route level, not just
 * hidden in the UI. MerchantLayout previously had a `// TODO: guard this
 * layout with the onboarding gate` comment and no actual guard — this was
 * a real, unimplemented spec violation (Groups 1-5 audit), not cosmetic:
 * a signed-in merchant who hadn't finished onboarding, or whose account
 * had since been suspended, could reach every merchant route directly.
 *
 * Three states beyond "render the page":
 *   1. Not signed in at all -> bounce to /login.
 *   2. Signed in but never completed onboarding -> bounce to the wizard.
 *   3. Completed onboarding but accountStatus isn't ACTIVE (e.g. an admin
 *      suspension after the fact) -> block in place with an explanation,
 *      since there's no better destination to redirect a suspended
 *      merchant to.
 */
export default function OnboardingGate({ children }) {
  const { firebaseUser, loading, needsOnboarding, merchantProfile, authError } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton variant="rect" height="6rem" />
        <Skeleton variant="rect" height="16rem" />
      </div>
    );
  }

  if (!firebaseUser) {
    return <Navigate to="/login" replace />;
  }

  if (needsOnboarding) {
    return <Navigate to="/merchant/onboarding" replace />;
  }

  if (authError) {
    return (
      <div className="p-6">
        <GlassCard tint="alert">
          <h1 className="text-base font-semibold">Couldn't load your account</h1>
          <p className="mt-2 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">{authError}</p>
        </GlassCard>
      </div>
    );
  }

  if (merchantProfile && merchantProfile.accountStatus !== 'ACTIVE') {
    return (
      <div className="p-6">
        <GlassCard tint="alert">
          <h1 className="text-base font-semibold">Account access restricted</h1>
          <p className="mt-2 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
            Your account status is currently <strong>{merchantProfile.accountStatus}</strong>. Dashboard, analytics,
            and transaction simulation are unavailable while your account isn't active. Contact support if you
            believe this is unexpected.
          </p>
        </GlassCard>
      </div>
    );
  }

  return children;
}
