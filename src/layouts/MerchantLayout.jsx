import { Outlet } from 'react-router-dom';
import AppShell from '../components/common/AppShell.jsx';
import OnboardingGate from '../components/common/OnboardingGate.jsx';

export default function MerchantLayout() {
  return (
    <AppShell role="MERCHANT" title="Merchant Workspace">
      <OnboardingGate>
        <Outlet />
      </OnboardingGate>
    </AppShell>
  );
}
