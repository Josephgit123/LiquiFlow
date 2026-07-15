import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFirestoreDoc } from '../../hooks/useFirestoreDoc.js';
import { apiFetch } from '../../services/apiClient.js';
import GlassCard from '../../components/common/GlassCard.jsx';
import Input from '../../components/common/Input.jsx';
import Button from '../../components/common/Button.jsx';

// Scoped to funding fields only — the ONLY real backend endpoint behind
// this nav entry is PATCH /api/merchants/me/funding, which itself only
// accepts this exact three-field allowlist (merchantRoutes.js). Confirmed
// scope (not Account info or Security/password) since no endpoint exists
// to edit onboarding-set business info, and password change belongs to
// Firebase Auth directly rather than this page.
const FIELDS = [
  { key: 'payoutBankLast4', label: 'Payout bank — last 4 digits', placeholder: '1234', maxLength: 4 },
  { key: 'payoutBankCountry', label: 'Payout bank country', placeholder: 'US' },
  { key: 'connectedGatewayProvider', label: 'Connected gateway provider', placeholder: 'Stripe' },
];

export default function LinkedFundingSettings() {
  const { firebaseUser } = useAuth();
  const merchantId = firebaseUser?.uid;
  const { data: merchantDoc } = useFirestoreDoc(merchantId ? `merchants/${merchantId}` : null);

  const [values, setValues] = useState({ payoutBankLast4: '', payoutBankCountry: '', connectedGatewayProvider: '' });
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  // Pre-fill once from the live doc, not on every snapshot tick — otherwise
  // an in-progress edit would get clobbered the moment Firestore pushes an
  // unrelated update to this same document.
  useEffect(() => {
    if (merchantDoc && !hydrated) {
      setValues({
        payoutBankLast4: merchantDoc.payoutBankLast4 || '',
        payoutBankCountry: merchantDoc.payoutBankCountry || '',
        connectedGatewayProvider: merchantDoc.connectedGatewayProvider || '',
      });
      setHydrated(true);
    }
  }, [merchantDoc, hydrated]);

  function handleChange(key, value) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      // Only send fields the user actually filled in — the backend rejects
      // unknown keys outright, but an empty string for an untouched field
      // is a valid (if pointless) value, so this still narrows to fields
      // with real content.
      const body = {};
      for (const field of FIELDS) {
        if (values[field.key]) body[field.key] = values[field.key];
      }
      if (Object.keys(body).length === 0) {
        setError('Enter at least one funding field before saving.');
        return;
      }
      await apiFetch('/merchants/me/funding', { method: 'PATCH', body });
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save funding settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Linked Funding Settings</h1>
        <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
          Manage the payout and gateway metadata linked to your account.
        </p>
      </div>

      <GlassCard className="flex flex-col gap-4">
        {FIELDS.map((field) => (
          <Input
            key={field.key}
            label={field.label}
            type="text"
            value={values[field.key]}
            onChange={(e) => handleChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
          />
        ))}

        {error && (
          <p role="alert" className="text-sm text-accent-alert">
            {error}
          </p>
        )}
        {saved && !error && (
          <p role="status" className="text-sm text-accent-liquid">
            Funding settings saved.
          </p>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} loading={saving}>
            Save Changes
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
