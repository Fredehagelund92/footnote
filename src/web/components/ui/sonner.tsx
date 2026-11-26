'use client'

import { useTheme } from '@/lib/theme-context'
import { Toaster as Sonner, useSonner, type ToasterProps } from 'sonner'

/** Where toasts appear. Each toast draws itself and keeps its own time (`@/lib/toast`). */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()
  return <Sonner theme={theme} {...props} />
}

export { Toaster, useSonner }
