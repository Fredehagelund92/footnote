import type * as React from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/** Efferd's dashboard card: a shadcn Card made flat, so the frame's hairlines are its only edges. */
export function Cell({ className, ...props }: React.ComponentProps<typeof Card>) {
  return (
    <Card className={cn('rounded-none bg-background shadow-none ring-0', className)} {...props} />
  )
}
