import { Outlet } from 'react-router-dom';
import Topbar from '../components/common/Topbar.jsx';

export default function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas-light text-ink-primary-light dark:bg-canvas-dark dark:text-ink-primary-dark">
      <Topbar title="LiquiFlow" />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
