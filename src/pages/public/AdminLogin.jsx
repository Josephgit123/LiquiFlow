import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAdminAuth } from '../../context/AdminAuthContext.jsx';
import Button from '../../components/common/Button.jsx';

// Inputs here are hand-rolled rather than the shared Input component —
// Input's classes are theme-aware (bg-surface-light dark:bg-surface-dark),
// which would make these fields flip to a light background in light mode,
// undermining AdminAuthLayout's deliberately-always-dark treatment.

// CLAUDE.md invariant #7: admin auth is a hardcoded credential check
// against env vars, entirely separate from Firebase Authentication — this
// page talks ONLY to AdminAuthContext/POST /api/admin/login, never
// AuthContext. The backend's own 401 message ("Invalid admin access
// credentials.") is already generic and never indicates which field was
// wrong — rendered as-is rather than re-worded, so there's one place
// (adminRoutes.js) that owns that copy, not two.
export default function AdminLogin() {
  const navigate = useNavigate();
  const { admin, loading, login } = useAdminAuth();

  const [accessId, setAccessId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && admin) {
      navigate('/admin/dashboard', { replace: true });
    }
  }, [loading, admin, navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(accessId, accessToken);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || 'Invalid admin access credentials.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex flex-col gap-6"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-reserve">Restricted access</p>
        <h1 className="mt-1 text-lg font-semibold text-ink-primary-dark">Administrator Login</h1>
        <p className="mt-1 text-sm text-ink-secondary-dark">
          Platform operations console. Not for merchant accounts.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5 text-sm">
          <label htmlFor="accessId" className="font-medium text-ink-primary-dark">
            Access ID
          </label>
          <input
            id="accessId"
            type="text"
            autoComplete="off"
            value={accessId}
            onChange={(e) => setAccessId(e.target.value)}
            className="rounded-lg border border-white/10 bg-canvas-dark px-3 py-2 text-sm text-ink-primary-dark outline-none transition focus:border-accent-reserve focus-visible:ring-2 focus-visible:ring-accent-reserve/30"
          />
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          <label htmlFor="accessToken" className="font-medium text-ink-primary-dark">
            Access Token
          </label>
          <input
            id="accessToken"
            type="password"
            autoComplete="off"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            className="rounded-lg border border-white/10 bg-canvas-dark px-3 py-2 text-sm text-ink-primary-dark outline-none transition focus:border-accent-reserve focus-visible:ring-2 focus-visible:ring-accent-reserve/30"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-accent-alert">
            {error}
          </p>
        )}

        <Button type="submit" disabled={submitting} loading={submitting} className="w-full !bg-accent-reserve focus-visible:!ring-accent-reserve/50">
          Sign In
        </Button>
      </form>
    </motion.div>
  );
}
