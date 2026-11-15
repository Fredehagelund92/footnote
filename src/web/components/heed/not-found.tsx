import type { ReactNode } from 'react'
import { buttonVariants } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'

/**
 * Somewhere that is not there: what is missing, why it may be, and a link to the place it would
 * have been found. Every missing page, item, definition, domain and documentation page uses it.
 */
export function NotFound({
  title,
  way,
  heading,
  children,
}: {
  title: string
  /** The way on: where to go instead. */
  way: { href: string; label: string }
  /** The title is the page's `h1`, for a page with no header of its own (the documentation). */
  heading?: boolean
  children: ReactNode
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle {...(heading && { role: 'heading', 'aria-level': 1 })}>{title}</EmptyTitle>
        <EmptyDescription className="wrap-anywhere">{children}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <a href={way.href} className={buttonVariants()}>
          {way.label}
        </a>
      </EmptyContent>
    </Empty>
  )
}
