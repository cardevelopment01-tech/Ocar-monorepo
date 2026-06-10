'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

interface SlideOverProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  width?: 'md' | 'lg'
}

export default function SlideOver({
  isOpen,
  onClose,
  title,
  children,
  width = 'md',
}: SlideOverProps) {
  const panelWidth = width === 'lg' ? '600px' : '480px'
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (isOpen) {
      document.documentElement.classList.add('overflow-hidden')
    } else {
      document.documentElement.classList.remove('overflow-hidden')
    }
    return () => {
      document.documentElement.classList.remove('overflow-hidden')
    }
  }, [isOpen])

  if (!mounted) return null

  // Rendered into document.body so fixed positioning is always viewport-relative,
  // regardless of any CSS transform on ancestor elements (e.g. animate-fade-in).
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Full-viewport backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50"
            style={{ zIndex: 45 }}
            onClick={onClose}
          />

          {/* Slide-over panel */}
          <motion.div
            key="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed top-0 right-0 h-screen bg-surface flex flex-col shadow-2xl"
            style={{ width: panelWidth, zIndex: 50 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0 bg-surface">
              <h2 className="text-lg font-semibold text-text-primary truncate pr-4">
                {title}
              </h2>
              <button
                onClick={onClose}
                className="flex-shrink-0 p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
