import { Navigate } from 'react-router-dom';
import { useAdminAuth } from '../../context/AdminAuthContext.jsx';
import Skeleton from './Skeleton.jsx';

// CLAUDE.md invariant #7: admin auth is fully isolated from Firebase
// Auth/merchant auth. AdminLayout previously had a `// TODO: guard this
// layout with requireAdminAuth-equivalent client check` and rendered its
// Outlet unconditionally — the real enforcement is server-side regardless,
// but the client had no guard at all, so an unauthenticated visitor would
// see the admin shell (Sidebar/Topbar) and a page attempting (and failing)
// API calls, rather than a clean redirect to admin login.
export default function AdminAuthGate({ children }) {
  const { admin, loading } = useAdminAuth();

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton variant="rect" height="6rem" />
        <Skeleton variant="rect" height="16rem" />
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/admin/login" replace />;
  }

  return children;
}
