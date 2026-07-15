import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import GlassCard from '../../components/common/GlassCard.jsx';

// Interstitial between the Landing Page's "Get Started" CTA and the two
// genuinely different sign-in destinations it can lead to — merchant
// Firebase Auth vs. the isolated admin credential gate (CLAUDE.md
// invariant #7). Previously "Get Started" linked straight to /login,
// giving an admin operator no path in from the landing page at all except
// knowing the /admin/login URL by heart.
const OPTIONS = [
  {
    to: '/login',
    tint: 'liquid',
    title: "I'm a Merchant",
    description: 'Sign in or create an account to manage your liquid pool, reserve vault, and settlements.',
  },
  {
    to: '/admin/login',
    tint: 'reserve',
    title: "I'm an Administrator",
    description: 'Restricted platform operations access — merchant management, risk configuration, and audit tools.',
  },
];

export default function GetStarted() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-10 px-4 py-20 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-center"
      >
        <h1 className="text-xl font-semibold">How would you like to continue?</h1>
        <p className="mt-2 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
          Choose the workspace you need — merchant accounts and admin operations are kept fully separate.
        </p>
      </motion.div>

      <div className="grid w-full gap-6 sm:grid-cols-2">
        {OPTIONS.map((option, i) => (
          <Link key={option.to} to={option.to} className="block">
            <GlassCard tint={option.tint} interactive delay={i * 0.08} className="flex h-full flex-col gap-2 text-left">
              <h2 className="text-base font-semibold">{option.title}</h2>
              <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">{option.description}</p>
              <span className="mt-2 text-sm font-medium text-accent-onlight-liquid dark:text-accent-liquid">
                Continue →
              </span>
            </GlassCard>
          </Link>
        ))}
      </div>
    </div>
  );
}
