// The logo (docs/design/logo.md), drawn in the public files heed-lockup.svg and heed-symbol.svg
// and shown here by reference, so a new mark is a change of those files alone and its paths load
// with them, not with the app's script. Today it is a placeholder: the name in Newsreader italic,
// and its F where a square mark is needed.
// One colour: the ink of the text around it, never the primary.
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { PRODUCT } from '@/lib/brand'

/** The drawing in a public file: its element `mark`, from the build's own base. */
const mark = (file: string) => `${import.meta.env.BASE_URL}${file}#mark`

export function LogoSymbol({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 36 40"
      fill="currentColor"
      aria-hidden="true"
      className={cn('h-5 w-auto shrink-0', className)}
      {...props}
    >
      <use href={mark('heed-symbol.svg')} />
    </svg>
  )
}

export function Logo({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 120 40"
      fill="currentColor"
      role="img"
      aria-label={PRODUCT}
      className={cn('h-5 w-auto shrink-0', className)}
      {...props}
    >
      <use href={mark('heed-lockup.svg')} />
    </svg>
  )
}
