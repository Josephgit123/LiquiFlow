import { Outlet } from 'react-router-dom';
import AppShell from '../components/common/AppShell.jsx';
import AdminAuthGate from '../components/common/AdminAuthGate.jsx';

export default function AdminLayout() {
  return (
    <AppShell role="ADMIN" title="Administrative Workspace">
      <AdminAuthGate>
        <Outlet />
      </AdminAuthGate>
    </AppShell>
  );
}
