import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import GlassCard from '../../components/common/GlassCard.jsx';
import CurrencyDisplay from '../../components/common/CurrencyDisplay.jsx';
import { RISK_TIERS, calculateIllustrativeSplit } from '../../utils/riskTiers.js';
import { tokens } from '../../styles/tokens.js';

const MIN_AMOUNT = 10000;
const MAX_AMOUNT = 500000;

export default function LandingPage() {
  const [amount, setAmount] = useState(100000);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-16 px-6 py-16">
      <section className="flex flex-col items-center gap-4 text-center">
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-xl font-semibold"
        >
          Post-authorization treasury, split by risk in real time.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="max-w-2xl text-base text-ink-secondary-light dark:text-ink-secondary-dark"
        >
          LiquiFlow scores every captured transaction and instantly routes funds between an
          available Liquid Pool and a time-locked Reserve Vault — automatically, per transaction.
        </motion.p>
        <Link
          to="/login"
          className="mt-2 rounded-lg bg-accent-liquid px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110"
        >
          Get Started
        </Link>
      </section>

      <section>
        <GlassCard tint="liquid" className="mx-auto max-w-2xl">
          <h2 className="text-base font-semibold">See how a transaction would split</h2>
          <p className="mt-1 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
            Drag to any capture amount — this is illustrative only, computed entirely in your
            browser from LiquiFlow's published tier table. No data leaves this page.
          </p>

          <div className="mt-6">
            <input
              type="range"
              min={MIN_AMOUNT}
              max={MAX_AMOUNT}
              step={1000}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: tokens.accent.liquid }}
              aria-label="Simulated capture amount"
            />
            <div className="mt-2 flex items-center justify-between text-xs text-ink-muted-light dark:text-ink-muted-dark">
              <span>$10,000</span>
              <CurrencyDisplay value={amount} animate={false} className="text-base" />
              <span>$500,000</span>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            {RISK_TIERS.map((tier) => {
              const split = calculateIllustrativeSplit(amount, tier);
              return (
                <div
                  key={tier.id}
                  className="flex items-center justify-between rounded-2xl border border-black/5 bg-black/[0.02] px-4 py-3 dark:border-white/5 dark:bg-white/[0.02]"
                >
                  <div>
                    <p className="text-sm font-medium">{tier.label}</p>
                    <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Hold: {tier.holdDuration}</p>
                  </div>
                  <div className="flex gap-4 text-right">
                    <div>
                      <p className="text-xs text-accent-liquid">Liquid now</p>
                      <CurrencyDisplay value={split.liquidAllocation} animate={false} />
                    </div>
                    <div>
                      <p className="text-xs text-accent-reserve">Reserve</p>
                      <CurrencyDisplay value={split.reserveAllocation} animate={false} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        <GlassCard tint="liquid">
          <h3 className="text-sm font-semibold text-accent-liquid">Instant Liquidity</h3>
          <p className="mt-2 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
            Low-risk captures release the vast majority of funds immediately — no manual payout requests.
          </p>
        </GlassCard>
        <GlassCard tint="reserve">
          <h3 className="text-sm font-semibold text-accent-reserve">Automatic Reserve Vaulting</h3>
          <p className="mt-2 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
            Higher-risk captures hold back a larger share in a time-locked vault, released
            automatically at maturity.
          </p>
        </GlassCard>
        <GlassCard tint="alert">
          <h3 className="text-sm font-semibold text-accent-alert">Real-Time Risk Scoring</h3>
          <p className="mt-2 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
            Every transaction is scored on industry, geography, and card velocity before funds move.
          </p>
        </GlassCard>
      </section>
    </div>
  );
}
