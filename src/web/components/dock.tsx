import type { ReactNode } from 'react'
import { ArrowLeftIcon, Maximize2Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { closeDock } from '@/lib/dock'
import { Panel } from '@/components/footnote/panel'

// The dock: Footnote's right panel. A region beside the page, not a dialog. 480 wide for Ask, a context
// peek, Try it and an agent's view; 720 for a review. Under 1100 px it is a sheet over the page, and
// on a phone it fills the screen.

export function DockFrame({
  title,
  quietTitle,
  actions,
  footer,
  foot,
  waiting,
  children,
}: {
  title: ReactNode
  /** A peek names what it is ("Context") quietly in the bar; its own title is in the body, once. */
  quietTitle?: boolean
  actions?: ReactNode
  footer?: ReactNode
  /** A footer that lays itself out, such as the review quick view's decision and what follows. */
  foot?: ReactNode
  /** While the dock's code loads. */
  waiting?: boolean
  children: ReactNode
}) {
  const isMobile = useIsMobile()
  // The shared panel anatomy; on a phone the dock is a screen of its own, so it goes back instead of closing.
  return (
    <Panel
      title={title}
      quietTitle={quietTitle}
      waiting={waiting}
      leading={
        isMobile && (
          <Button variant="ghost" size="icon" aria-label="Back" onClick={closeDock}>
            <ArrowLeftIcon />
          </Button>
        )
      }
      actions={actions}
      onClose={isMobile ? undefined : closeDock}
      footer={
        // One footer language for every dock: the bar's height, actions on the right at the header's
        // button size, on a second row before one of them is cut. On a phone they are full width and
        // 44px for a finger, the main action on a row of its own (data-dock-footer, styles/index.css).
        footer ? (
          <div
            data-dock-footer
            className="flex min-h-bar flex-wrap items-center justify-end gap-2 px-4 py-2.5 md:px-5"
          >
            {footer}
          </div>
        ) : (
          foot
        )
      }
    >
      {children}
    </Panel>
  )
}

/** A peek's bar: previous and next, then the expand icon that opens the page. */
export function PeekBar({ children, onExpand }: { children?: ReactNode; onExpand: () => void }) {
  return (
    <>
      {children}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Open the page" onClick={onExpand} />
          }
        >
          <Maximize2Icon />
        </TooltipTrigger>
        <TooltipContent>Open the page</TooltipContent>
      </Tooltip>
    </>
  )
}

/** What the dock shows when its link points at something that isn't there. */
export function DockMissing({ children }: { children: ReactNode }) {
  return <p className="p-4 text-sm text-muted-foreground md:p-5">{children}</p>
}

/**
 * A dock while its code loads: its frame at once, with its title and Close, so it is never an
 * empty strip. Its read's own states are DockRead's (dock-read.tsx), which stays off the first load.
 */
export function DockWaiting({ title }: { title: string }) {
  return (
    <DockFrame title={title} waiting>
      <div role="status" aria-busy="true" aria-label="Loading" className="min-h-24" />
    </DockFrame>
  )
}
