import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch, ApiError } from '../../services/apiClient.js';
import Button from '../../components/common/Button.jsx';
import Input from '../../components/common/Input.jsx';

// entityType/industryVector/currency enums match onboardingService.js's
// VALID_ENTITY_TYPES/VALID_INDUSTRY_VECTORS/VALID_CURRENCIES exactly
// (Step 13) — the backend rejects anything else with 400.
const ENTITY_TYPES = [
  { value: 'LLC', label: 'LLC' },
  { value: 'C_CORP', label: 'C Corporation' },
  { value: 'SOLE_PROP', label: 'Sole Proprietorship' },
];

// Risk weights sourced directly from PAYMENT_FLOW.md / CLAUDE.md's
// industry vector table — shown for transparency about the onboarding
// risk baseline, not invented for this page.
const INDUSTRY_VECTORS = [
  { value: 'GROCERY', label: 'Grocery', riskWeight: 0 },
  { value: 'ELECTRONICS', label: 'Electronics', riskWeight: 15 },
  { value: 'GAMING', label: 'Gaming', riskWeight: 25 },
  { value: 'CRYPTO', label: 'Crypto', riskWeight: 40 },
];

// targetVolume is a free-form self-declared STRING per DATABASE_SCHEMA.md
// (no backend enum) — these are illustrative preset ranges, an invented
// but low-stakes UI convenience, not a contract the backend enforces.
const TARGET_VOLUME_RANGES = [
  '$0 – $10,000/mo',
  '$10,000 – $50,000/mo',
  '$50,000 – $250,000/mo',
  '$250,000 – $1,000,000/mo',
  '$1,000,000+/mo',
];

const CURRENCIES = [
  { value: 'USD', label: 'US Dollar (USD)' },
  { value: 'EUR', label: 'Euro (EUR)' },
  { value: 'INR', label: 'Indian Rupee (INR)' },
];

function OptionGroup({ options, value, onChange, renderExtra }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50 ${
              selected
                ? 'border-accent-liquid bg-accent-liquid/10 text-accent-liquid'
                : 'border-border-token-light text-ink-primary-light hover:bg-surface-light-elevated dark:border-border-token-dark dark:text-ink-primary-dark dark:hover:bg-surface-dark-elevated'
            }`}
          >
            <span>{option.label}</span>
            {renderExtra ? renderExtra(option) : null}
          </button>
        );
      })}
    </div>
  );
}

// Single source of truth for step order, label, validity, and content —
// previously three parallel index-keyed structures (STEP_LABELS array, an
// isStepValid switch, and a separate JSX switch) that had to be edited in
// lockstep to add/remove/reorder a step (Groups 1-5 audit).
const STEPS = [
  {
    label: 'Business',
    isValid: (form) => form.businessName.trim().length >= 2,
    render: ({ form, updateField }) => (
      <div>
        <Input
          label="Legal business name"
          id="businessName"
          type="text"
          value={form.businessName}
          onChange={(e) => updateField('businessName', e.target.value)}
          placeholder="Acme Co."
        />
      </div>
    ),
  },
  {
    label: 'Entity Type',
    isValid: (form) => ENTITY_TYPES.some((o) => o.value === form.entityType),
    render: ({ form, updateField }) => (
      <div>
        <p className="mb-3 text-sm font-medium">Entity type</p>
        <OptionGroup options={ENTITY_TYPES} value={form.entityType} onChange={(v) => updateField('entityType', v)} />
      </div>
    ),
  },
  {
    label: 'Industry',
    isValid: (form) => INDUSTRY_VECTORS.some((o) => o.value === form.industryVector),
    render: ({ form, updateField }) => (
      <div>
        <p className="mb-3 text-sm font-medium">Industry vector</p>
        <OptionGroup
          options={INDUSTRY_VECTORS}
          value={form.industryVector}
          onChange={(v) => updateField('industryVector', v)}
          renderExtra={(option) => (
            <span className="rounded-full bg-accent-reserve/15 px-2 py-0.5 text-xs font-semibold text-accent-onlight-reserve dark:text-accent-reserve">
              +{option.riskWeight} base risk
            </span>
          )}
        />
        <p className="mt-3 text-xs text-ink-muted-light dark:text-ink-muted-dark">
          This sets your industry's contribution to each transaction's risk score — geography
          and card velocity are scored separately, per transaction, once you're live.
        </p>
      </div>
    ),
  },
  {
    label: 'Volume',
    isValid: (form) => TARGET_VOLUME_RANGES.includes(form.targetVolume),
    render: ({ form, updateField }) => (
      <div>
        <p className="mb-3 text-sm font-medium">Expected monthly processing volume</p>
        <OptionGroup
          options={TARGET_VOLUME_RANGES.map((v) => ({ value: v, label: v }))}
          value={form.targetVolume}
          onChange={(v) => updateField('targetVolume', v)}
        />
      </div>
    ),
  },
  {
    label: 'Currency',
    isValid: (form) => CURRENCIES.some((o) => o.value === form.currency),
    render: ({ form, updateField }) => (
      <div>
        <p className="mb-3 text-sm font-medium">Settlement currency</p>
        <OptionGroup options={CURRENCIES} value={form.currency} onChange={(v) => updateField('currency', v)} />
      </div>
    ),
  },
];

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const { firebaseUser, loading, merchantProfile, refreshProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [form, setForm] = useState({
    businessName: '',
    entityType: '',
    industryVector: '',
    targetVolume: '',
    currency: '',
  });
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const stepHeadingRef = useRef(null);

  // Redirect unauthenticated visitors to Login, and already-onboarded
  // merchants straight to the Dashboard — onboarding is one-shot
  // (onboardingService.js rejects a second attempt with 409), so there's
  // no reason to show this wizard again once merchantProfile exists. The
  // SOLE place this redirect happens — handleFinish below deliberately
  // does not also call navigate() after a successful submit, since
  // refreshProfile() populating merchantProfile already re-triggers this
  // effect; calling both was a redundant double-navigate.
  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      navigate('/login', { replace: true });
      return;
    }
    if (merchantProfile) {
      navigate('/merchant/dashboard', { replace: true });
    }
  }, [loading, firebaseUser, merchantProfile, navigate]);

  // Moves focus to the (visually hidden but real) step heading on every
  // step change, and its aria-live wrapper announces it — previously a
  // screen-reader user got zero signal that content changed at all, since
  // the persistent Next/Back buttons keep focus in place.
  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [step]);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function goNext() {
    if (!STEPS[step].isValid(form)) return;
    setDirection(1);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleFinish() {
    // Re-entrancy guard: `disabled` only takes effect after React
    // re-renders, so a very fast double-click/double-Enter could
    // otherwise fire two POSTs before the first render lands.
    if (submitting) return;
    if (!STEPS[step].isValid(form)) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      // businessName is trimmed here (not on every keystroke in
      // updateField, which would fight the user mid-edit) — the raw
      // onChange value was previously persisted verbatim, letting padded
      // whitespace reach Firestore.
      await apiFetch('/merchants/onboard', { method: 'POST', body: { ...form, businessName: form.businessName.trim() } });
      await refreshProfile();
      // No navigate() here — see the redirect effect above.
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Already onboarded from another tab/session — not an error the
        // user needs to act on, but worth a debug trail.
        // eslint-disable-next-line no-console
        console.info('[OnboardingWizard] 409 on submit — already onboarded elsewhere; refreshing and redirecting.');
        await refreshProfile();
        setSubmitting(false);
        return;
      }
      // Surface field-specific validation messages when the backend sends
      // them (400 { message, errors: [{field, message}] }) — previously
      // only the generic top-level message rendered, discarding detail a
      // real mismatch (e.g. a stale enum) would need to be actionable.
      const fieldErrors = err.body?.errors;
      setSubmitError(
        Array.isArray(fieldErrors) && fieldErrors.length > 0
          ? fieldErrors.map((e) => e.message).join(' ')
          : err.message || 'Something went wrong. Please try again.'
      );
      setSubmitting(false);
    }
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    if (isLastStep) {
      handleFinish();
    } else {
      goNext();
    }
  }

  const isLastStep = step === STEPS.length - 1;
  const stepValid = STEPS[step].isValid(form);

  return (
    <form onSubmit={handleFormSubmit} className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Set Up Your Merchant Account</h1>
        <p className="mt-1 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
          A few quick questions establish your initial risk baseline and processing profile.
        </p>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center">
        {STEPS.map((s, index) => (
          <div key={s.label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition ${
                  index < step
                    ? 'bg-accent-liquid text-ink-primary-light'
                    : index === step
                      ? 'bg-accent-liquid/15 text-accent-onlight-liquid ring-2 ring-accent-liquid dark:text-accent-liquid'
                      : 'bg-surface-light-elevated text-ink-muted-light dark:bg-surface-dark-elevated dark:text-ink-muted-dark'
                }`}
              >
                {index < step ? '✓' : index + 1}
              </div>
              {/* sr-only below `sm` (still readable by assistive tech),
                  not `hidden` (which previously removed it from the
                  accessibility tree entirely, not just visually). */}
              <span className="sr-only text-xs text-ink-muted-light sm:not-sr-only dark:text-ink-muted-dark">
                {s.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={`mx-2 h-px flex-1 transition ${
                  index < step ? 'bg-accent-liquid' : 'bg-border-token-light dark:bg-border-token-dark'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Visible fallback identifying the current step on narrow viewports,
          where the progress dots alone (numerals/checkmarks) carry no
          step name once the sr-only swap above hides the inline label. */}
      <p className="-mt-4 text-xs font-medium text-ink-muted-light sm:hidden dark:text-ink-muted-dark">
        Step {step + 1} of {STEPS.length}: {STEPS[step].label}
      </p>

      <motion.div layout className="relative min-h-[160px] overflow-hidden rounded-xl">
        {/* mode="wait" previously blocked the incoming step on the outgoing
            step's exit animation firing onExitComplete — under StrictMode's
            double-invoke behavior that callback could fail to fire at all,
            freezing the wizard on the old step forever even though `step`
            state had already advanced (progress dots read `step` directly
            and kept advancing correctly). popLayout mounts the new step
            immediately and pops the old one out of flow instead of waiting. */}
        <AnimatePresence mode="popLayout" custom={direction} initial={false}>
          <motion.div
            key={step}
            custom={direction}
            initial={{ opacity: 0, x: direction * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -40 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <h2
              ref={stepHeadingRef}
              tabIndex={-1}
              aria-live="polite"
              className="sr-only"
            >
              Step {step + 1} of {STEPS.length}: {STEPS[step].label}
            </h2>
            {STEPS[step].render({ form, updateField })}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {submitError && (
        <p role="alert" className="text-sm text-accent-alert">
          {submitError}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button type="button" variant="secondary" onClick={goBack} disabled={step === 0 || submitting}>
          Back
        </Button>

        {isLastStep ? (
          <Button type="submit" disabled={!stepValid || submitting} loading={submitting}>
            Finish
          </Button>
        ) : (
          <Button type="submit" disabled={!stepValid}>
            Next
          </Button>
        )}
      </div>
    </form>
  );
}
