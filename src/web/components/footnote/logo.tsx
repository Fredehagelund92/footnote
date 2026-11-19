// The logo (docs/design/logo.md), drawn in the public files footnote-lockup.svg and footnote-symbol.svg
// and shown here by reference, so a new mark is a change of those files alone and its paths load
// with them, not with the app's script. The symbol is an asterisk with one arm come loose as a dot;
// the lockup sets it before "footnote" in Outfit 600, outlined.
// One colour: the ink of the text around it, never the primary.
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { PRODUCT } from '@/lib/brand'

/** The drawing in a public file: its element `mark`, from the build's own base. */
const mark = (file: string) => `${import.meta.env.BASE_URL}${file}#mark`

export function LogoSymbol({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="currentColor"
      aria-hidden="true"
      className={cn('h-5 w-auto shrink-0', className)}
      {...props}
    >
      <use href={mark('footnote-symbol.svg')} />
    </svg>
  )
}

export function Logo({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      viewBox="0 0 125 26"
      fill="currentColor"
      role="img"
      aria-label={PRODUCT}
      className={cn('h-5 w-auto shrink-0', className)}
      {...props}
    >
      <use href={mark('footnote-lockup.svg')} />
    </svg>
  )
}
