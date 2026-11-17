import * as React from 'react'
import { CommandIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

/** The web font has no command key sign, so the system font would draw it: a drawn icon takes its place. */
function withCommandIcon(children: React.ReactNode) {
  return React.Children.map(children, (child) =>
    typeof child === 'string' && child.includes('⌘')
      ? child
          .split('⌘')
          .flatMap((part, i) => [
            i > 0 && <CommandIcon key={i} role="img" aria-label="Command" />,
            part,
          ])
      : child,
  )
}

function Kbd({ className, children, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    >
      {withCommandIcon(children)}
    </kbd>
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn('inline-flex items-center gap-1', className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
