import { motion } from 'framer-motion';

// Route-level enter/exit motion — previously ONLY AuthLayout had this (its
// Login<->Register swap); MerchantLayout, AdminLayout, and PublicLayout had
// no transition wrapper at all, so every navigation just snapped. Used as
// `<AnimatePresence mode="wait"><PageTransition key={location.pathname}>
// <Outlet /></PageTransition></AnimatePresence>` — the key on this
// component (not a manual prop) is what makes React Router's route change
// trigger the exit/enter cycle.
export default function PageTransition({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
