import type { ReactNode } from 'react'
import { ArrowLeftIcon, Maximize2Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { Kbd } from '@/components/ui/kbd'
import { closeDock, dockBack, DOCK_TITLE, useDockBack, type DockKind } from '@/lib/dock'
import { useFact } from '@/lib/workspace'
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
  const back = useDockBack()
  // The shared panel anatomy; on a phone the dock is a screen of its own, so it leaves instead of
  // closing. With a step back to take, the arrow says it leaves and the link goes back.
  return (
    <Panel
      title={title}
      quietTitle={quietTitle}
      waiting={waiting}
      leading={
        isMobile && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={back ? 'Close the panel' : 'Back'}
            onClick={closeDock}
          >
            <ArrowLeftIcon />
          </Button>
        )
      }
      back={back && <BackLink from={back.from} steps={back.steps} />}
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

/** The words for a panel in the Back link: an item's or a definition's own title, else the panel's name. */
function useTitleOf({ kind, id }: { kind: DockKind; id?: string }) {
  const fact = useFact(kind === 'context' ? id : undefined)
  if (kind === 'context') return fact?.title
  if (kind === 'def') return id
  return DOCK_TITLE[kind]
}

/** One step back to the panel this one was reached from; the bar's close always leaves the panel. */
function BackLink({ from, steps }: { from: { kind: DockKind; id?: string }; steps: number }) {
  const title = useTitleOf(from)
  return (
    <div data-dock-back className="flex h-9 shrink-0 items-center border-b px-2 md:px-4">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              className="-ml-1.5 max-w-full min-w-0 justify-start gap-1.5 px-1.5 font-normal text-muted-foreground"
              onClick={() => dockBack(steps)}
            />
          }
        >
          <ArrowLeftIcon />
          <span className="truncate">{title ? `Back to ${title}` : 'Back'}</span>
        </TooltipTrigger>
        <TooltipContent>
          Back <Kbd>H</Kbd>
        </TooltipContent>
      </Tooltip>
    </div>
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
