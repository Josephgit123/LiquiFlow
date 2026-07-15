import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import Button from '../../components/common/Button.jsx';

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <p className="text-xl font-semibold text-ink-primary-light dark:text-ink-primary-dark">404</p>
      <p className="max-w-xs text-sm text-ink-muted-light dark:text-ink-muted-dark">
        This page doesn't exist, or you don't have access to it.
      </p>
      <Link to="/" className="mt-2">
        <Button variant="secondary">Go home</Button>
      </Link>
    </motion.div>
  );
}
