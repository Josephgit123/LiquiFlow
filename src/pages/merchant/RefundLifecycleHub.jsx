import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFirestoreDoc } from '../../hooks/useFirestoreDoc.js';
import { useApiList } from '../../hooks/useApiList.js';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { apiFetch } from '../../services/apiClient.js';
import { toDate } from '../../utils/firestoreTime.js';
import GlassCard from '../../components/common/GlassCard.jsx';
import CurrencyDisplay from '../../components/common/CurrencyDisplay.jsx';
import StatusBadge from '../../components/common/StatusBadge.jsx';
import Modal from '../../components/common/Modal.jsx';
import DetailRow from '../../components/common/DetailRow.jsx';
import Button from '../../components/common/Button.jsx';
import Input from '../../components/common/Input.jsx';

export default function RefundLifecycleHub() {
  const { firebaseUser, merchantProfile } = useAuth();
  const merchantId = firebaseUser?.uid;
  const currency = merchantProfile?.currency || 'USD';

  // Live balance via onSnapshot — the client-side eligibility check below
  // needs the CURRENT availableLiquid, not a stale value.
  const { data: balanceDoc } = useFirestoreDoc(merchantId ? `merchant_balances/${merchantId}` : null);
  const availableLiquid = balanceDoc?.availableLiquid ?? 0;

  // Only CAPTURED transactions are refund-eligible (refundService.js, Step
  // 10) — scoping the list to them here rather than showing everything and
  // letting most rows be dead ends.
  const { items: transactions, loading, error, reload } = useApiList('/transactions?status=CAPTURED&limit=100');

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [reason, setReason] = useState('');
  const [successMessage, setSuccessMessage] = useState(null);
  const { submitting, error: submitError, setError: setSubmitError, run } = useAsyncAction();

  const filtered = useMemo(() => {
    if (!search.trim()) return transactions;
    const needle = search.trim().toLowerCase();
    return transactions.filter((t) => t.transactionId.toLowerCase().includes(needle));
  }, [transactions, search]);

  const selected = transactions.find((t) => t.transactionId === selectedId) || null;

  // UX nicety only — refundService.js enforces both of these server-side
  // inside the same atomic transaction (Step 10); this just avoids a
  // pointless round-trip for an obviously-ineligible transaction.
  const eligibility = useMemo(() => {
    if (!selected) return null;
    if (selected.status !== 'CAPTURED') {
      return { eligible: false, reason: `This transaction is already ${selected.status}.` };
    }
    if (selected.amountGross > availableLiquid) {
      return { eligible: false, reason: 'Refund amount exceeds your current available liquid.' };
    }
    return { eligible: true, reason: null };
  }, [selected, availableLiquid]);

  function openConfirm() {
    // Generated once when the dialog opens, reused on retry — so a retry
    // after a dropped response can't double-refund (Step 10's idempotency
    // check keys off this exact value).
    setIdempotencyKey(crypto.randomUUID());
    setReason('');
    setSubmitError(null);
    setConfirmOpen(true);
  }

  async function handleConfirmRefund() {
    if (!selected) return;
    const result = await run(() =>
      apiFetch('/transactions/refund', {
        method: 'POST',
        body: {
          transactionId: selected.transactionId,
          refundAmount: selected.amountGross,
          reason: reason || undefined,
          idempotencyKey,
        },
      })
    );
    if (result) {
      setConfirmOpen(false);
      setSuccessMessage(`Refund submitted for ${selected.transactionId}.`);
      setSelectedId(null);
      reload();
    }
  }

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Refund Lifecycle Hub</h1>
          <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
            Search a captured transaction to initiate a refund.
          </p>
        </div>
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by transaction ID…"
          aria-label="Search by transaction ID"
        />
        {error && (
          <p role="alert" className="text-sm text-accent-alert">
            {error}
          </p>
        )}
        <div className="flex max-h-[560px] flex-col gap-2 overflow-y-auto">
          {loading && <p className="text-sm text-ink-muted-light dark:text-ink-muted-dark">Loading…</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-ink-muted-light dark:text-ink-muted-dark">No captured transactions found.</p>
          )}
          {filtered.map((t) => (
            <button
              key={t.transactionId}
              type="button"
              onClick={() => setSelectedId(t.transactionId)}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50 ${
                selectedId === t.transactionId
                  ? 'border-accent-liquid bg-accent-liquid/10'
                  : 'border-border-token-light hover:bg-surface-light-elevated dark:border-border-token-dark dark:hover:bg-surface-dark-elevated'
              }`}
            >
              <span className="font-mono text-xs">{t.transactionId}</span>
              <CurrencyDisplay value={t.amountGross} currency={currency} animate={false} />
            </button>
          ))}
        </div>
      </div>

      <div>
        {successMessage && (
          <p role="status" className="mb-4 text-sm text-accent-liquid">
            {successMessage}
          </p>
        )}
        {!selected && (
          <GlassCard>
            <p className="py-12 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">
              Select a transaction on the left to view refund details.
            </p>
          </GlassCard>
        )}
        {selected && (
          <GlassCard tint={eligibility?.eligible ? 'liquid' : 'alert'}>
            <h2 className="text-base font-semibold">Transaction {selected.transactionId}</h2>
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <DetailRow label="Date" value={toDate(selected.timestamp)?.toLocaleString() ?? '—'} />
              <DetailRow label="Status" value={<StatusBadge value={selected.status} />} />
              <DetailRow
                label="Amount"
                value={<CurrencyDisplay value={selected.amountGross} currency={currency} animate={false} />}
              />
              <DetailRow
                label="Currently available liquid"
                value={<CurrencyDisplay value={availableLiquid} currency={currency} animate={false} />}
              />
            </div>

            {!eligibility.eligible && (
              <p role="alert" className="mt-4 text-sm text-accent-alert">
                {eligibility.reason}
              </p>
            )}

            <Button
              variant="primary"
              disabled={!eligibility.eligible}
              onClick={openConfirm}
              className="mt-6 w-full"
            >
              Refund This Transaction
            </Button>
          </GlassCard>
        )}
      </div>

      <Modal open={confirmOpen} onClose={() => !submitting && setConfirmOpen(false)} title="Confirm Refund">
        {selected && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
              This refunds <CurrencyDisplay value={selected.amountGross} currency={currency} animate={false} /> from
              transaction <span className="font-mono text-xs">{selected.transactionId}</span>, deducted from your
              available liquid. This cannot be undone.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Reason (optional)"
              aria-label="Refund reason (optional)"
              className="w-full rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none transition focus:border-accent-liquid focus-visible:ring-2 focus-visible:ring-accent-liquid/30 dark:border-border-token-dark dark:bg-surface-dark"
            />
            {submitError && (
              <p role="alert" className="text-sm text-accent-alert">
                {submitError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleConfirmRefund} disabled={submitting} loading={submitting}>
                Confirm Refund
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
