'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { SHEET_SPRING } from '@/lib/motion'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
  showHandle?: boolean
  className?: string
}

export default function BottomSheet({
  isOpen,
  onClose,
  children,
  showHandle = true,
  className,
}: BottomSheetProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/30 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            className={cn(
              'fixed bottom-0 left-0 right-0 mx-auto max-w-[430px]',
              'bg-surface rounded-t-3xl shadow-sheet z-50',
              'max-h-[85vh] overflow-y-auto',
              className
            )}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={SHEET_SPRING}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.15}
            onDragEnd={(_e: unknown, info: { offset: { y: number } }) => {
              if (info.offset.y > 80) onClose()
            }}
          >
            {showHandle && <div className="sheet-handle" />}
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
