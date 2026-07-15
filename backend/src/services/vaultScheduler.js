import crypto from 'node:crypto';
import { sweepMaturedCapsules } from './vaultService.js';
import { acquireSchedulerLock, releaseSchedulerLock } from './schedulerLock.js';

// CLAUDE.md invariant #8 / PAYMENT_FLOW.md: the release scheduler polls
// every 60 seconds.
const SWEEP_INTERVAL_MS = 60000;
// Comfortably exceeds the interval so a slow sweep never loses its own
// lock mid-run (DEPLOYMENT_GUIDE.md step 4).
const LEASE_DURATION_MS = 90000;

// Randomly generated once per process, not something guessable or shared
// across instances — this is the identity acquireSchedulerLock races on.
const workerId = crypto.randomUUID();

let timeoutHandle = null;
let activeDb = null;
let holdsLock = false;
let stopped = true;

export function getWorkerId() {
  return workerId;
}

async function tick() {
  if (stopped || !activeDb) return;
  const db = activeDb;

  try {
    const acquired = await acquireSchedulerLock(db, workerId, LEASE_DURATION_MS);
    holdsLock = acquired;

    if (!acquired) {
      // Another instance holds the lock this tick — skip the sweep
      // entirely rather than queuing or retrying within the same tick.
      console.log('[vaultScheduler] lock held by another instance — skipping this tick.');
    } else {
      let summary = await sweepMaturedCapsules(db);
      console.log(
        `[vaultScheduler] sweep complete: released=${summary.released} failed=${summary.failed} remaining=${summary.remaining} durationMs=${summary.durationMs}`
      );

      // If the batch cap was hit, a backlog may remain. Drain it
      // immediately (while still holding the lock and paying no repeat
      // acquisition cost) rather than waiting a full interval per
      // remaining batch — chosen because a backlog means real merchant
      // funds are sitting released-but-unswept longer than the tier's
      // intended hold duration, and this worker already has the lock.
      while (summary.remaining && !stopped) {
        summary = await sweepMaturedCapsules(db);
        console.log(
          `[vaultScheduler] backlog sweep complete: released=${summary.released} failed=${summary.failed} remaining=${summary.remaining} durationMs=${summary.durationMs}`
        );
      }
    }
  } catch (err) {
    // An unexpected error (e.g. a Firestore outage) must not silently
    // kill the scheduler forever — log and keep rescheduling.
    console.error(`[vaultScheduler] tick failed: ${err.message}`);
  }

  // Reschedule only after this tick's work has fully completed, so a slow
  // sweep can never overlap with the next tick.
  if (!stopped) {
    timeoutHandle = setTimeout(tick, SWEEP_INTERVAL_MS);
  }
}

/**
 * Starts the scheduler. Must be explicitly invoked (e.g. from server.js,
 * behind the ENABLE_VAULT_SCHEDULER env flag) — importing this module has
 * no side effect on its own.
 */
export function startVaultScheduler(db) {
  if (!stopped) return; // already running
  stopped = false;
  activeDb = db;
  timeoutHandle = setTimeout(tick, 0); // first tick fires promptly on boot
}

/**
 * Stops the scheduler (clean shutdown / test teardown). Best-effort
 * releases the lock if this instance currently holds it, so another
 * instance doesn't have to wait out the full lease after a clean stop.
 */
export function stopVaultScheduler() {
  stopped = true;
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }

  if (holdsLock && activeDb) {
    const db = activeDb;
    releaseSchedulerLock(db, workerId).catch((err) => {
      console.error(`[vaultScheduler] releaseSchedulerLock on stop failed: ${err.message}`);
    });
  }

  holdsLock = false;
  activeDb = null;
}
