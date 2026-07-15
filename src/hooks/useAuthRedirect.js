import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Routes an already-authenticated (or just-authenticated) merchant based on
 * AuthContext's resolved needsOnboarding/merchantProfile state — identical
 * logic previously duplicated verbatim in MerchantLogin.jsx and
 * MerchantRegister.jsx.
 */
export function useAuthRedirect() {
  const navigate = useNavigate();
  const { firebaseUser, loading, needsOnboarding, merchantProfile } = useAuth();

  useEffect(() => {
    if (loading || !firebaseUser) return;
    if (needsOnboarding) {
      navigate('/merchant/onboarding', { replace: true });
    } else if (merchantProfile) {
      navigate('/merchant/dashboard', { replace: true });
    }
  }, [loading, firebaseUser, needsOnboarding, merchantProfile, navigate]);
}
