import type * as React from 'react'
import { ArrowUpRightIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { docHref, docTitle, publicDocHref } from '@/lib/doc-links'

const link =
  'inline-flex min-h-6 w-fit items-center gap-1 text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline'

/** Under an aside's help: one quiet link to its guide in the documentation, which opens as its own site. */
export function GuideLink({ slug, className }: { slug: string; className?: string }) {
  const title = docTitle(slug)
  if (!title) return null
  return (
    <a href={docHref(slug)} target="_blank" rel="noreferrer" className={cn(link, className)}>
      Read the guide
      <ArrowUpRightIcon className="size-3.5" aria-hidden />
      <span className="sr-only">: {title} (opens in a new tab)</span>
    </a>
  )
}

/**
 * A link to a page of the public docs that the app's own Docs do not hold: what whoever runs the
 * service does where it runs, such as connecting a model. Its words say where it leads.
 */
export function PublicGuideLink({
  slug,
  className,
  children,
}: {
  slug: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <a href={publicDocHref(slug)} target="_blank" rel="noreferrer" className={cn(link, className)}>
      {children}
      <ArrowUpRightIcon className="size-3.5" aria-hidden />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
