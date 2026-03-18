import { type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

interface PageContainerProps {
  children: ReactNode;
  className?: string;
}

export default function PageContainer({ children, className }: PageContainerProps) {
  return (
    <motion.div
      className={cn('mx-auto w-full max-w-[1440px] px-6 pb-16 pt-8 sm:px-8 lg:px-12', className)}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
