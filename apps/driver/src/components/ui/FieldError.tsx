import { motion, AnimatePresence, useAnimationControls } from 'framer-motion'

export function useShake() {
  const controls = useAnimationControls()
  const shake = () => void controls.start({
    x: [0, -6, 6, -4, 4, 0],
    transition: { duration: 0.35, ease: 'easeInOut' },
  })
  return { controls, shake }
}

export function ShakeWrap({ controls, children }: { controls: ReturnType<typeof useAnimationControls>; children: React.ReactNode }) {
  return <motion.div animate={controls}>{children}</motion.div>
}

export default function FieldError({ message }: { message?: string | null }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {message && (
        <motion.p
          key={message}
          initial={{ opacity: 0, height: 0, y: -4 }}
          animate={{ opacity: 1, height: 'auto', y: 0 }}
          exit={{ opacity: 0, height: 0, y: -4 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="text-accent-red text-xs mt-1 overflow-hidden"
        >
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  )
}
