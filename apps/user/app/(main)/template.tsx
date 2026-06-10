'use client'

import { motion } from 'framer-motion'

/**
 * Next.js re-mounts `template.tsx` on every navigation (unlike `layout.tsx`),
 * so this gives each route a fresh enter animation. Opacity-only on purpose:
 * a transform here would become the containing block for any `position:fixed`
 * children inside pages, and would shift the fragile h-full map chain.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="h-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
