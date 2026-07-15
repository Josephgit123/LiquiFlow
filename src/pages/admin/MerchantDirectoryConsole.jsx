import { useMemo, useState } from 'react';
import { useApiList } from '../../hooks/useApiList.js';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { adminApiFetch } from '../../services/apiClient.js';
import DataTable from '../../components/common/DataTable.jsx';
import StatusBadge from '../../components/common/StatusBadge.jsx';
import CurrencyDisplay from '../../components/common/CurrencyDisplay.jsx';
import Modal from '../../components/common/Modal.jsx';
import Button from '../../components/common/Button.jsx';

const PAGE_SIZE = 20;
const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED'];
const INDUSTRY_VECTORS = ['GROCERY', 'ELECTRONICS', 'GAMING', 'CRYPTO'];

export default function MerchantDirectoryConsole() {
  const [accountStatus, setAccountStatus] = useState('');
  const [industryVector, setIndustryVector] = useState('');
  const [offset, setOffset] = useState(0);

  const queryPath = useMemo(() => {
    const params = new URLSearchParams();
    if (accountStatus) params.set('accountStatus', accountStatus);
    if (industryVector) params.set('industryVector', industryVector);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    return `/admin/merchants?${params.toString()}`;
  }, [accountStatus, industryVector, offset]);

  const { items, hasMore, loading, error, reload } = useApiList(queryPath, adminApiFetch);

  const [target, setTarget] = useState(null); // { merchant, nextStatus }
  const [reason, setReason] = useState('');
  const { submitting, error: actionError, setError: setActionError, run } = useAsyncAction();

  function openStatusConfirm(merchant) {
    setTarget({ merchant, nextStatus: merchant.accountStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' });
    setReason('');
    setActionError(null);
  }

  async function handleConfirmStatusChange() {
    if (!reason.trim()) {
      setActionError('A reason is required.');
      return;
    }
    const result = await run(() =>
      adminApiFetch(`/admin/merchants/${target.merchant.merchantId}/status`, {
        method: 'PATCH',
        body: { accountStatus: target.nextStatus, reason: reason.trim() },
      })
    );
    if (result) {
      setTarget(null);
      reload();
    }
  }

  function handleFilterChange(setter) {
    return (value) => {
      setter(value);
      setOffset(0);
    };
  }

  const columns = [
    { key: 'businessName', label: 'Business', sortable: true },
    { key: 'industryVector', label: 'Industry' },
    {
      key: 'currentRiskTier',
      label: 'Risk Tier',
      render: (row) => <StatusBadge value={row.tierOverride ?? row.currentRiskTier} />,
    },
    {
      key: 'accountStatus',
      label: 'Status',
      render: (row) => <StatusBadge value={row.accountStatus} />,
    },
    {
      key: 'availableLiquid',
      label: 'Available Liquid',
      align: 'right',
      render: (row) =>
        row.balance ? <CurrencyDisplay value={row.balance.availableLiquid} currency={row.balance.currency} animate={false} /> : '—',
    },
    {
      key: 'lockedEscrow',
      label: 'Locked Reserve',
      align: 'right',
      render: (row) =>
        row.balance ? <CurrencyDisplay value={row.balance.lockedEscrow} currency={row.balance.currency} animate={false} /> : '—',
    },
    {
      key: 'action',
      label: '',
      align: 'right',
      render: (row) => (
        <button
          type="button"
          onClick={() => openStatusConfirm(row)}
          className={`rounded text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50 ${
            row.accountStatus === 'ACTIVE' ? 'text-accent-alert' : 'text-accent-liquid'
          }`}
        >
          {row.accountStatus === 'ACTIVE' ? 'Suspend' : 'Activate'}
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Merchant Directory Console</h1>
        <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
          Search, review, and manage onboarded merchant accounts.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Status</span>
          <select
            value={accountStatus}
            onChange={(e) => handleFilterChange(setAccountStatus)(e.target.value)}
            className="rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none focus:border-accent-liquid focus-visible:ring-2 focus-visible:ring-accent-liquid/30 dark:border-border-token-dark dark:bg-surface-dark"
          >
            <option value="">All</option>
            {ACCOUNT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Industry</span>
          <select
            value={industryVector}
            onChange={(e) => handleFilterChange(setIndustryVector)(e.target.value)}
            className="rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none focus:border-accent-liquid focus-visible:ring-2 focus-visible:ring-accent-liquid/30 dark:border-border-token-dark dark:bg-surface-dark"
          >
            <option value="">All</option>
            {INDUSTRY_VECTORS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-accent-alert">
          {error}
        </p>
      )}

      <DataTable
        columns={columns}
        rows={items}
        loading={loading}
        emptyMessage="No merchants match these filters."
        limit={PAGE_SIZE}
        offset={offset}
        hasMore={hasMore}
        onPageChange={setOffset}
        getRowKey={(row) => row.merchantId}
      />

      <Modal
        open={Boolean(target)}
        onClose={() => !submitting && setTarget(null)}
        title={target ? `${target.nextStatus === 'SUSPENDED' ? 'Suspend' : 'Activate'} ${target.merchant.businessName}` : ''}
      >
        {target && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
              This changes <strong>{target.merchant.businessName}</strong>'s account status from{' '}
              <StatusBadge value={target.merchant.accountStatus} /> to <StatusBadge value={target.nextStatus} />.
              {target.nextStatus === 'SUSPENDED' && ' Suspending immediately blocks their dashboard, analytics, and transaction capture.'}
            </p>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">
                Reason <span className="text-accent-alert">*</span>
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                required
                placeholder="Required — recorded in the audit log"
                className="w-full rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none transition focus:border-accent-liquid focus-visible:ring-2 focus-visible:ring-accent-liquid/30 dark:border-border-token-dark dark:bg-surface-dark"
              />
            </label>
            {actionError && (
              <p role="alert" className="text-sm text-accent-alert">
                {actionError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setTarget(null)} disabled={submitting}>
                Cancel
              </Button>
              <Button
                variant={target.nextStatus === 'SUSPENDED' ? 'destructive' : 'primary'}
                onClick={handleConfirmStatusChange}
                disabled={submitting || !reason.trim()}
                loading={submitting}
              >
                Confirm
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
