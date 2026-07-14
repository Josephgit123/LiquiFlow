import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch, ApiError } from '../../services/apiClient.js';

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

const STEP_LABELS = ['Business', 'Entity Type', 'Industry', 'Volume', 'Currency'];

function isStepValid(step, form) {
  switch (step) {
    case 0:
      return form.businessName.trim().length >= 2;
    case 1:
      return ENTITY_TYPES.some((o) => o.value === form.entityType);
    case 2:
      return INDUSTRY_VECTORS.some((o) => o.value === form.industryVector);
    case 3:
      return TARGET_VOLUME_RANGES.includes(form.targetVolume);
    case 4:
      return CURRENCIES.some((o) => o.value === form.currency);
    default:
      return false;
  }
}

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
            className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${
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

  // Redirect unauthenticated visitors to Login, and already-onboarded
  // merchants straight to the Dashboard — onboarding is one-shot
  // (onboardingService.js rejects a second attempt with 409), so there's
  // no reason to show this wizard again once merchantProfile exists.
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

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function goNext() {
    if (!isStepValid(step, form)) return;
    setDirection(1);
    setStep((s) => Math.min(s + 1, STEP_LABELS.length - 1));
  }

  function goBack() {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleFinish() {
    if (!isStepValid(step, form)) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await apiFetch('/merchants/onboard', { method: 'POST', body: form });
      await refreshProfile();
      navigate('/merchant/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Already onboarded from another tab/session — just proceed.
        await refreshProfile();
        navigate('/merchant/dashboard', { replace: true });
        return;
      }
      setSubmitError(err.message || 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  const isLastStep = step === STEP_LABELS.length - 1;
  const stepValid = isStepValid(step, form);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">Set Up Your Merchant Account</h1>
        <p className="mt-1 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
          A few quick questions establish your initial risk baseline and processing profile.
        </p>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center">
        {STEP_LABELS.map((label, index) => (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition ${
                  index < step
                    ? 'bg-accent-liquid text-white'
                    : index === step
                      ? 'bg-accent-liquid/15 text-accent-liquid ring-2 ring-accent-liquid'
                      : 'bg-surface-light-elevated text-ink-muted-light dark:bg-surface-dark-elevated dark:text-ink-muted-dark'
                }`}
              >
                {index < step ? '✓' : index + 1}
              </div>
              <span className="hidden text-xs text-ink-muted-light dark:text-ink-muted-dark sm:block">{label}</span>
            </div>
            {index < STEP_LABELS.length - 1 && (
              <div
                className={`mx-2 h-px flex-1 transition ${
                  index < step ? 'bg-accent-liquid' : 'bg-border-token-light dark:bg-border-token-dark'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      <div className="relative min-h-[220px] overflow-hidden">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={step}
            custom={direction}
            initial={{ opacity: 0, x: direction * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -40 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            {step === 0 && (
              <div>
                <label htmlFor="businessName" className="mb-2 block text-sm font-medium">
                  Legal business name
                </label>
                <input
                  id="businessName"
                  type="text"
                  value={form.businessName}
                  onChange={(e) => updateField('businessName', e.target.value)}
                  placeholder="Acme Co."
                  className="w-full rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none focus:border-accent-liquid dark:border-border-token-dark dark:bg-surface-dark"
                />
              </div>
            )}

            {step === 1 && (
              <div>
                <p className="mb-3 text-sm font-medium">Entity type</p>
                <OptionGroup
                  options={ENTITY_TYPES}
                  value={form.entityType}
                  onChange={(v) => updateField('entityType', v)}
                />
              </div>
            )}

            {step === 2 && (
              <div>
                <p className="mb-3 text-sm font-medium">Industry vector</p>
                <OptionGroup
                  options={INDUSTRY_VECTORS}
                  value={form.industryVector}
                  onChange={(v) => updateField('industryVector', v)}
                  renderExtra={(option) => (
                    <span className="rounded-full bg-accent-reserve/15 px-2 py-0.5 text-xs font-semibold text-accent-reserve">
                      +{option.riskWeight} base risk
                    </span>
                  )}
                />
                <p className="mt-3 text-xs text-ink-muted-light dark:text-ink-muted-dark">
                  This sets your industry's contribution to each transaction's risk score — geography
                  and card velocity are scored separately, per transaction, once you're live.
                </p>
              </div>
            )}

            {step === 3 && (
              <div>
                <p className="mb-3 text-sm font-medium">Expected monthly processing volume</p>
                <OptionGroup
                  options={TARGET_VOLUME_RANGES.map((v) => ({ value: v, label: v }))}
                  value={form.targetVolume}
                  onChange={(v) => updateField('targetVolume', v)}
                />
              </div>
            )}

            {step === 4 && (
              <div>
                <p className="mb-3 text-sm font-medium">Settlement currency</p>
                <OptionGroup
                  options={CURRENCIES}
                  value={form.currency}
                  onChange={(v) => updateField('currency', v)}
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {submitError && <p className="text-sm text-accent-alert">{submitError}</p>}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 0 || submitting}
          className="rounded-lg border border-border-token-light px-4 py-2 text-sm font-medium text-ink-primary-light transition hover:bg-surface-light-elevated disabled:opacity-40 dark:border-border-token-dark dark:text-ink-primary-dark dark:hover:bg-surface-dark-elevated"
        >
          Back
        </button>

        {isLastStep ? (
          <button
            type="button"
            onClick={handleFinish}
            disabled={!stepValid || submitting}
            className="rounded-lg bg-accent-liquid px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? 'Finishing…' : 'Finish'}
          </button>
        ) : (
          <button
            type="button"
            onClick={goNext}
            disabled={!stepValid}
            className="rounded-lg bg-accent-liquid px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
