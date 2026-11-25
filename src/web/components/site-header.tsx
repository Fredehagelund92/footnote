import * as React from 'react'
import type { ReactNode } from 'react'
import {
  ArrowLeftIcon,
  EllipsisIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  SearchIcon,
} from '@/components/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ThemeChoices, ThemeMenu } from '@/components/theme-menu'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Kbd } from '@/components/ui/kbd'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { open } from '@/lib/events'
import { TruncatedText } from '@/components/footnote/truncated'
import { OfflineBanner } from '@/components/footnote/load-state'
import { ProfileLabel } from '@/components/footnote/profile-label'
import { ViewAs, ViewAsChoices, useViewAs } from '@/components/view-as'
import { pageTitle } from '@/lib/page-title'
import { plainClick } from '@/lib/router'
import { useSession } from '@/api/queries'

/**
 * A way back, left of the title. With `onBack` a plain click goes back as the page's Esc does,
 * such as back in history to the list it came from; the link still opens elsewhere.
 */
export type WayBack = { href: string; label: string; onBack?: () => void }

/** The nav's toggle, always in the same spot, saying what it will do and its shortcut. */
function NavToggle() {
  const { state, isMobile } = useSidebar()
  const label = isMobile
    ? 'Open the menu'
    : state === 'expanded'
      ? 'Collapse the sidebar'
      : 'Expand the sidebar'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarTrigger
            aria-label={label}
            aria-expanded={isMobile ? undefined : state === 'expanded'}
            className="aria-expanded:bg-transparent aria-expanded:hover:bg-muted"
          />
        }
      />
      <TooltipContent>
        {label} <Kbd>⌘B</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * A deep page's header on a phone keeps the way back, the title, the page's one main action and
 * this: everything else it would hold (the page's own menu, Ask, the nav, search, the theme and the
 * demo's person) behind one More button, so the title keeps its room.
 */
function PhoneMore({
  ask,
  nav = true,
  children,
}: {
  ask?: () => void
  /** Whether it opens the nav: a page that keeps its nav toggle has no need. */
  nav?: boolean
  children?: ReactNode
}) {
  const { toggleSidebar } = useSidebar()
  const viewAs = useViewAs()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More" />}>
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {children && (
          <>
            {children}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          {ask && (
            <DropdownMenuItem onClick={ask}>
              <MessageSquareIcon />
              Ask about this
            </DropdownMenuItem>
          )}
          {nav && (
            <DropdownMenuItem onClick={toggleSidebar}>
              <PanelLeftIcon />
              Open the menu
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => open('palette')}>
            <SearchIcon />
            Search
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <ThemeChoices />
        </DropdownMenuGroup>
        {viewAs && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>View as: {viewAs.name}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-72">
                <ViewAsChoices />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// The page header, as Efferd's app shell has it: a 48px row that lines up with the sidebar's
// header, the sidebar trigger, a separator, the page as a quiet 14px title with its icon, actions
// as small outline buttons on the right, and a translucent background that content scrolls under.
export function SiteHeader({
  title,
  icon,
  children,
  className,
  back,
  deep,
  bare,
  ask,
  more,
  fold,
}: {
  /**
   * The page's name, or a breadcrumb that leads to it. A breadcrumb's current page is the page's
   * `h1`, or the page has its own below, so the heading is the name alone and never the trail's
   * words run together.
   */
  title: ReactNode
  icon?: ReactNode
  children?: ReactNode
  className?: string
  /** A way back, left of the title (an editor goes back to what it edits). */
  back?: WayBack
  /**
   * A page reached from a list or a link (an item, a definition, a review, a conflict). On a phone
   * its crumbs are gone, so it gets the way back, and everything but the page's main action moves
   * into one More menu (search, the theme, the nav and the person, with `ask` and `more`) so the
   * title keeps room to be read. A laptop's header is unchanged.
   */
  deep?: WayBack
  /** On a phone, the page's Ask, in the More menu. The page draws its own button on a laptop. */
  ask?: () => void
  /** On a phone, the page's own menu items, first in the More menu. */
  more?: ReactNode
  /** Leaves out search and the theme: the page's own More menu has them, so the title keeps its room. */
  bare?: boolean
  /**
   * On a phone, search and the theme in one More menu: a page with more header buttons than one
   * (Ask's History and New chat) keeps them a tap away and the install's label its words.
   */
  fold?: boolean
}) {
  const { isMobile } = useSidebar()
  const { profileLabel } = useSession()
  const lean = !!deep && isMobile
  const folded = !!fold && isMobile && !lean && !bare
  const way = back ?? (lean ? deep : undefined)
  // The tab says the page's heading: the header's, or the page's own under it (an item's title).
  const ref = React.useRef<HTMLElement>(null)
  // An item's heading arrives with its data, after this header has rendered, so the title also
  // follows the page as it changes.
  React.useEffect(() => {
    const sync = () => {
      const h1 = ref.current?.querySelector('h1') ?? ref.current?.parentElement?.querySelector('h1')
      const next = pageTitle(h1?.textContent)
      if (document.title !== next) document.title = next
    }
    sync()
    const root = ref.current?.parentElement
    if (!root) return
    const watch = new MutationObserver(sync)
    watch.observe(root, { childList: true, subtree: true, characterData: true })
    return () => watch.disconnect()
  })
  return (
    <>
      <header
        ref={ref}
        data-site-header
        className={cn(
          'relative z-header flex h-bar shrink-0 items-center justify-between gap-2 px-4 shadow-hairline-bottom sm:gap-3 md:px-6',
          'bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/50',
          className,
        )}
      >
        <div className="flex min-w-0 grow items-center gap-3">
          {!lean && <NavToggle />}
          <Separator
            orientation="vertical"
            className={cn(
              'h-4 data-vertical:self-center',
              // On a phone the title needs the room more than the line (U10).
              lean ? 'hidden' : way ? 'max-md:hidden' : 'mr-2 max-md:hidden',
            )}
          />
          {way && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={way.label}
                    className="pointer-coarse:min-w-11"
                    nativeButton={false}
                    render={<a href={way.href} onClick={way.onBack && plainClick(way.onBack)} />}
                  />
                }
              >
                <ArrowLeftIcon />
              </TooltipTrigger>
              <TooltipContent>{way.label}</TooltipContent>
            </Tooltip>
          )}
          {typeof title === 'string' ? (
            // A phone's title gives up its icon before a letter of its words: "Definitions", never "Defini…".
            <h1 className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground [&>svg]:size-3.5 [&>svg]:shrink-0 max-md:[&>svg]:hidden">
              {icon}
              {/* A long title is cut with an ellipsis and shown in full on hover or focus. */}
              <TruncatedText text={title} className="min-w-0" />
            </h1>
          ) : (
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground [&>svg]:size-3.5 [&>svg]:shrink-0">
              {icon}
              <span className="min-w-0 truncate">{title}</span>
            </div>
          )}
        </div>
        <div data-header-actions className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* On a phone the sidebar is a sheet, so search lives here, as a magnifier. */}
          {isMobile && !bare && !lean && !folded && (
            <Button
              variant="outline"
              size="icon"
              aria-label="Search"
              onClick={() => open('palette')}
            >
              <SearchIcon />
            </Button>
          )}
          {children}
        </div>
        {/* Which install this is, when it is named: last but the theme, so it never moves. It has no
            width of its own and takes what the title leaves, up to its words: on a phone a page's
            action is its icon alone, so the label keeps its words, and only a long one is cut, never
            the title. With room for less than a few letters it wraps onto a second line, which is
            cut off: an empty first line holds the height. */}
        {!lean && profileLabel && (
          <span className="flex h-5 w-0 max-w-fit min-w-0 grow-1000 flex-wrap justify-end overflow-hidden">
            <span aria-hidden className="h-5 w-0" />
            <ProfileLabel label={profileLabel} className="min-w-0 shrink grow basis-12" />
          </span>
        )}
        <div data-header-actions className="flex shrink-0 items-center gap-2 empty:hidden sm:gap-3">
          {!bare && !lean && !folded && <ThemeMenu />}
          {/* The demo's switch between its people, in the corner: nothing anywhere else. */}
          {!bare && !lean && !folded && <ViewAs />}
          {lean && <PhoneMore ask={ask}>{more}</PhoneMore>}
          {folded && <PhoneMore nav={false} />}
        </div>
      </header>
      {/* Offline, one quiet line right under the header, so the header keeps its line with the sidebar. */}
      <OfflineBanner />
    </>
  )
}

/** A page: the header, then a body that scrolls on its own. */
export function Page({
  title,
  icon,
  actions,
  children,
  className,
  bodyRef,
  deep,
  ask,
  more,
}: {
  title: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  /** See SiteHeader. */
  deep?: WayBack
  ask?: () => void
  more?: ReactNode
  children: ReactNode
  className?: string
  /** The scrolling body, for a page that measures its own width. */
  bodyRef?: (el: HTMLDivElement | null) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SiteHeader title={title} icon={icon} deep={deep} ask={ask} more={more}>
        {actions}
      </SiteHeader>
      <div
        ref={bodyRef}
        data-slot="page-scroll"
        className={cn('@container/main min-h-0 flex-1 overflow-y-auto', className)}
      >
        {children}
      </div>
    </div>
  )
}
