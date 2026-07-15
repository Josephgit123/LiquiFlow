import { useEffect, useMemo, useRef, useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { useFirestoreCollection } from '../../hooks/useFirestoreCollection.js';
import { useFirestoreDoc } from '../../hooks/useFirestoreDoc.js';
import { useApiList } from '../../hooks/useApiList.js';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';
import { apiFetch } from '../../services/apiClient.js';
import { toDate } from '../../utils/firestoreTime.js';
import GlassCard from '../../components/common/GlassCard.jsx';
import StatusBadge from '../../components/common/StatusBadge.jsx';
import Modal from '../../components/common/Modal.jsx';
import Button from '../../components/common/Button.jsx';
import Input from '../../components/common/Input.jsx';

const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const DESCRIPTION_LIMIT = 2000;

function TicketListItem({ ticket, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col gap-1 rounded-xl border px-4 py-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50 ${
        active
          ? 'border-accent-liquid bg-accent-liquid/10'
          : 'border-border-token-light hover:bg-surface-light-elevated dark:border-border-token-dark dark:hover:bg-surface-dark-elevated'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{ticket.subject}</span>
        <StatusBadge value={ticket.status} />
      </div>
      <span className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
        {ticket.priority} · {toDate(ticket.createdAt)?.toLocaleDateString() ?? '—'}
      </span>
    </button>
  );
}

// Live message thread reads tickets/{id}/messages directly via onSnapshot
// (firestore.rules extended alongside this page to permit it — the
// subcollection previously had no rule at all, so it was default-denied).
// The ticket doc itself is also read live so status flips (e.g. an admin
// reply moving OPEN -> PENDING) show up without a manual refresh.
function TicketThread({ ticketId, fallbackTicket, onStatusChange }) {
  // fallbackTicket is the ticket metadata already fetched via REST for the
  // list on the left — used until/unless the live Firestore doc arrives, so
  // the header never gets stuck on "Loading…" if the live subscription lags
  // (or, in the rare case, never resolves — e.g. a composite-index gap;
  // ticketService.js flags one is still needed for merchantId+status+
  // orderBy).
  const { data: ticketDoc } = useFirestoreDoc(ticketId ? `tickets/${ticketId}` : null);
  const displayTicket = ticketDoc ?? fallbackTicket;
  const constraints = useMemo(() => [orderBy('createdAt', 'asc')], []);
  const { data: messages, loading } = useFirestoreCollection(
    ticketId ? `tickets/${ticketId}/messages` : null,
    constraints
  );

  const [reply, setReply] = useState('');
  const { submitting, error, run } = useAsyncAction();
  const scrollRef = useRef(null);

  useEffect(() => {
    if (ticketDoc) onStatusChange?.(ticketDoc.status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketDoc?.status]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function handleSend() {
    if (!reply.trim()) return;
    const result = await run(() => apiFetch(`/tickets/${ticketId}/messages`, { method: 'POST', body: { body: reply.trim() } }));
    if (result) setReply('');
  }

  return (
    <GlassCard className="flex h-[560px] flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{displayTicket?.subject ?? 'Loading…'}</h2>
          {displayTicket && (
            <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
              {displayTicket.priority} priority
            </p>
          )}
        </div>
        {displayTicket && <StatusBadge value={displayTicket.status} />}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-xl bg-surface-light-elevated/50 p-3 dark:bg-surface-dark-elevated/50">
        {loading && <p className="text-sm text-ink-muted-light dark:text-ink-muted-dark">Loading messages…</p>}
        {!loading && messages.length === 0 && (
          <p className="text-sm text-ink-muted-light dark:text-ink-muted-dark">
            No replies yet. Your original description is the first message in this thread.
          </p>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                m.authorRole === 'ADMIN'
                  ? 'self-start bg-accent-reserve/10 text-ink-primary-light dark:text-ink-primary-dark'
                  : 'self-end bg-accent-liquid/15 text-ink-primary-light dark:text-ink-primary-dark'
              }`}
            >
              <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-muted-light dark:text-ink-muted-dark">
                {m.authorRole === 'ADMIN' ? 'LiquiFlow Support' : 'You'} ·{' '}
                {toDate(m.createdAt)?.toLocaleString() ?? ''}
              </p>
              {m.body}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-accent-alert">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Input
          type="text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend();
          }}
          placeholder="Type a reply…"
          aria-label="Reply message"
          className="flex-1"
        />
        <Button onClick={handleSend} disabled={submitting || !reply.trim()} loading={submitting}>
          Send
        </Button>
      </div>
    </GlassCard>
  );
}

export default function SupportDesk() {
  const [selectedId, setSelectedId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  const listPath = useMemo(
    () => (statusFilter ? `/tickets?status=${statusFilter}&limit=100` : '/tickets?limit=100'),
    [statusFilter]
  );
  const { items: tickets, loading, error, reload } = useApiList(listPath);
  // Live-patched by TicketThread's onStatusChange so the list reflects an
  // admin's reply moving a ticket to PENDING without waiting for a reload.
  const [liveStatusOverrides, setLiveStatusOverrides] = useState({});
  const ticketsWithLiveStatus = tickets.map((t) => (liveStatusOverrides[t.ticketId] ? { ...t, status: liveStatusOverrides[t.ticketId] } : t));

  const [createOpen, setCreateOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [description, setDescription] = useState('');
  const { submitting: creating, error: createError, setError: setCreateError, run: runCreate } = useAsyncAction();

  function handleLiveStatusChange(newStatus) {
    setLiveStatusOverrides((prev) => ({ ...prev, [selectedId]: newStatus }));
  }

  async function handleCreate() {
    setCreateError(null);
    if (!subject.trim()) return setCreateError('Subject is required.');
    if (!description.trim()) return setCreateError('Description is required.');
    if (description.length > DESCRIPTION_LIMIT) {
      return setCreateError(`Description must be ${DESCRIPTION_LIMIT} characters or fewer.`);
    }

    const result = await runCreate(() =>
      apiFetch('/tickets', { method: 'POST', body: { subject: subject.trim(), priority, description } })
    );
    if (result) {
      setCreateOpen(false);
      setSubject('');
      setPriority('MEDIUM');
      setDescription('');
      reload();
    }
  }

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1.4fr]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">Support Desk</h1>
            <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
              Open, track, and reply to support tickets.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>Create Ticket</Button>
        </div>

        <label className="sr-only" htmlFor="ticket-status-filter">
          Filter by status
        </label>
        <select
          id="ticket-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none focus:border-accent-liquid focus-visible:ring-2 focus-visible:ring-accent-liquid/30 dark:border-border-token-dark dark:bg-surface-dark"
        >
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="PENDING">Pending</option>
          <option value="RESOLVED">Resolved</option>
        </select>

        {error && (
          <p role="alert" className="text-sm text-accent-alert">
            {error}
          </p>
        )}
        <div className="flex max-h-[500px] flex-col gap-2 overflow-y-auto">
          {loading && <p className="text-sm text-ink-muted-light dark:text-ink-muted-dark">Loading…</p>}
          {!loading && ticketsWithLiveStatus.length === 0 && (
            <p className="text-sm text-ink-muted-light dark:text-ink-muted-dark">No tickets found.</p>
          )}
          {ticketsWithLiveStatus.map((t) => (
            <TicketListItem
              key={t.ticketId}
              ticket={t}
              active={selectedId === t.ticketId}
              onClick={() => setSelectedId(t.ticketId)}
            />
          ))}
        </div>
      </div>

      <div>
        {!selectedId && (
          <GlassCard>
            <p className="py-12 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">
              Select a ticket on the left to view its thread.
            </p>
          </GlassCard>
        )}
        {selectedId && (
          <TicketThread
            ticketId={selectedId}
            fallbackTicket={ticketsWithLiveStatus.find((t) => t.ticketId === selectedId) || null}
            onStatusChange={handleLiveStatusChange}
          />
        )}
      </div>

      <Modal open={createOpen} onClose={() => !creating && setCreateOpen(false)} title="Create Ticket">
        <div className="flex flex-col gap-3">
          <Input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            aria-label="Subject"
          />
          <label className="sr-only" htmlFor="ticket-priority">
            Priority
          </label>
          <select
            id="ticket-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none focus:border-accent-liquid focus-visible:ring-2 focus-visible:ring-accent-liquid/30 dark:border-border-token-dark dark:bg-surface-dark"
          >
            {VALID_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="ticket-description">
            Describe the issue
          </label>
          <textarea
            id="ticket-description"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_LIMIT))}
            rows={5}
            placeholder="Describe the issue…"
            className="w-full rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none transition focus:border-accent-liquid focus-visible:ring-2 focus-visible:ring-accent-liquid/30 dark:border-border-token-dark dark:bg-surface-dark"
          />
          <p className="text-right text-xs text-ink-muted-light dark:text-ink-muted-dark">
            {description.length}/{DESCRIPTION_LIMIT}
          </p>
          {createError && (
            <p role="alert" className="text-sm text-accent-alert">
              {createError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating} loading={creating}>
              Create Ticket
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
