import * as React from 'react'
import { Changed } from '@/components/footnote/changed'
import { cn } from '@/lib/utils'
import {
  ActivityIcon,
  BookAIcon,
  InboxIcon,
  MessageSquareIcon,
  NotebookTextIcon,
  SearchIcon,
  SettingsIcon,
} from '@/components/icons'
import { Logo, LogoSymbol } from '@/components/footnote/logo'
import { NavUser } from '@/components/nav-user'
import { SettingsNav } from '@/components/settings-nav'
import { landingOf } from '@/lib/settings-access'
import { ObservabilityNav } from '@/components/obs/obs-nav'
import { seesObservability } from '@/lib/obs'
import { Kbd } from '@/components/ui/kbd'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { open } from '@/lib/events'
import { useDestination, useLocationNow, useRoute } from '@/lib/router'
import { useNeedsYou } from '@/lib/inbox-rows'
import { useMe } from '@/lib/workspace'
import { PRODUCT } from '@/lib/brand'
import { HelpMenu } from '@/components/help-menu'

// The sidebar-07 block (collapsible to icons), with Footnote's three places, Settings for admins,
// and the user menu in the footer. Dressed as Efferd's app shell: the page background with a
// hairline, a 48px header row that lines up with the page header, quieter item labels, and a faint
// light at the top in dark mode.
/**
 * shadcn's sidebar rail, made draggable: drag it to set the sidebar's width (it follows the pointer
 * 1:1), or click it to collapse and expand as before. Dragging a collapsed rail outward opens it.
 */
function ResizeRail({ onWidth }: { onWidth: (width: number, done: boolean) => void }) {
  const { state, setOpen, toggleSidebar } = useSidebar()
  const drag = React.useRef<{ x: number; width: number; moved: boolean } | null>(null)
  const end = () => delete document.documentElement.dataset.resizing
  return (
    <SidebarRail
      aria-label={state === 'expanded' ? 'Resize or collapse the sidebar' : 'Expand the sidebar'}
      title={state === 'expanded' ? 'Drag to resize, click to collapse' : 'Click or drag to expand'}
      className="touch-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const width =
          document.querySelector('[data-slot="sidebar-container"]')?.getBoundingClientRect()
            .width ?? 256
        drag.current = { x: e.clientX, width, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        if (!d.moved && Math.abs(dx) < 4) return
        d.moved = true
        if (state === 'collapsed') {
          if (dx > 48) setOpen(true)
          return
        }
        document.documentElement.dataset.resizing = '1'
        onWidth(d.width + dx, false)
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (d?.moved && state === 'expanded') onWidth(d.width + (e.clientX - d.x), true)
        end()
      }}
      onPointerCancel={() => {
        drag.current = null
        end()
      }}
      onClick={() => {
        // A drag ends in a click too; only a click without movement collapses or expands.
        if (!drag.current?.moved) toggleSidebar()
        drag.current = null
      }}
    />
  )
}

/**
 * A press on a place, and the navigation the address was at when it was made. `down` is a press the pointer is still
 * holding, `off` one taken back, `spent` one whose travel has run.
 */
type Press = { id: string; at: object; down?: boolean; off?: boolean; spent?: boolean }

/**
 * How long a press holds the highlight's travel open. The travel is 150ms (--dur-2) and starts on
 * the frame after the press, so this is that with room to spare. After it the place pressed is
 * still the selected one, but it is no longer travelling anywhere.
 */
const TRAVEL_SPENT = 400

export function AppSidebar({
  onWidth,
  ...props
}: React.ComponentProps<typeof Sidebar> & { onWidth: (width: number, done: boolean) => void }) {
  const route = useRoute()
  const me = useMe()
  const { isMobile, setOpenMobile } = useSidebar()
  const place = route.parts[0] ?? 'inbox'
  const going = useDestination()
  const at = useLocationNow()
  const count = useNeedsYou()
  const close = () => isMobile && setOpenMobile(false)

  const items = [
    { id: 'inbox', title: 'Inbox', icon: InboxIcon, badge: count || undefined },
    { id: 'ask', title: 'Ask', icon: MessageSquareIcon },
    { id: 'context', title: 'Context', icon: NotebookTextIcon },
    { id: 'definitions', title: 'Definitions', icon: BookAIcon },
  ]

  // A press answers before the new page has drawn: the place pressed takes the selected look the
  // moment the pointer goes down, and the one highlight starts its 150ms travel there then, which
  // runs on the compositor while the main thread draws the page (docs/design/motion.md). A press
  // holds the highlight's travel open until it has run, and then is spent: a later arrival at the
  // same place, from the keyboard or from Back, is simply there.
  const [press, setPress] = React.useState<Press | null>(null)
  // The place the sidebar shows as yours: the one pressed, until the address moves, whichever way
  // and wherever to, or the press is taken back. A press held down keeps it, however long it is
  // held; one let go keeps it until its travel is spent, so a move that never comes (the editor's
  // leave guard) gives the sidebar back to the address.
  const pending =
    press && !press.off && press.at === at && (press.down || !press.spent) ? press.id : null
  const here = pending ?? going
  // The highlight travels while the press that moved it is on its way, and until it has arrived
  // where that press asked for: a move the press had nothing to do with is simply there.
  const travel = press !== null && !press.spent && (press.at === at || press.id === going)
  const takeBack = () => setPress((p) => (p ? { ...p, off: true } : p))
  const letGo = () => setPress((p) => (p?.down ? { ...p, down: false } : p))
  React.useEffect(() => {
    if (!press || press.spent) return
    const spend = setTimeout(() => setPress((p) => (p ? { ...p, spent: true } : p)), TRAVEL_SPENT)
    return () => clearTimeout(spend)
  }, [press])
  React.useEffect(() => {
    if (!pending) return
    const cancel = (e: KeyboardEvent) => e.key === 'Escape' && takeBack()
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [pending])
  // Only a press that moves inside the app answers: not the right button, and not a modifier key,
  // which opens the link somewhere else (lib/router.ts).
  const onPointerDown = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || id === going) return
    setPress({ id, at, down: true })
  }
  /** What a place in the sidebar needs to answer a press at once. */
  const answers = (id: string) => ({
    isActive: here === id,
    'data-pending': pending === id || undefined,
    onPointerDown: onPointerDown(id),
    // A press is taken back if the pointer leaves the place while it is still down; once it has
    // been let go there, the move is on its way and leaving the place means nothing.
    onPointerLeave: (e: React.PointerEvent) => e.buttons & 1 && takeBack(),
    onPointerUp: letGo,
    onPointerCancel: takeBack,
  })

  return (
    <Sidebar
      collapsible="icon"
      className={cn(
        '*:data-[slot=sidebar-inner]:bg-background',
        '*:data-[slot=sidebar-inner]:dark:bg-(image:--glow-top)',
      )}
      {...props}
    >
      {place === 'settings' ? (
        <SettingsNav section={route.parts[1] ?? 'general'} close={close} />
      ) : place === 'observability' && seesObservability(me) ? (
        <ObservabilityNav section={route.parts[1] ?? 'overview'} close={close} />
      ) : (
        <>
          <SidebarHeader className="h-bar justify-center px-2 shadow-hairline-bottom">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<a href="/inbox" aria-label={PRODUCT} onClick={close} />}
                >
                  <Logo className="h-5! w-auto! group-data-[collapsible=icon]:hidden" aria-hidden />
                  <LogoSymbol className="mx-auto hidden h-5! w-auto! group-data-[collapsible=icon]:block" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent label="Main">
            {/* Search is a field, not a page: set apart above the list. In the icon rail it is one
                magnifier with a gap under it. Both open the search palette. */}
            <SidebarGroup className="pb-1">
              <button
                type="button"
                onClick={() => {
                  close()
                  open('palette')
                }}
                className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm text-muted-foreground transition-colors outline-none group-data-[collapsible=icon]:hidden hover:border-foreground/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <SearchIcon className="size-4 shrink-0" aria-hidden />
                <span className="flex-1 text-left">Search</span>
                <Kbd>⌘K</Kbd>
              </button>
              <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Search"
                    onClick={() => {
                      close()
                      open('palette')
                    }}
                  >
                    <SearchIcon />
                    <span>Search</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
            <SidebarGroup className="pt-2 group-data-[collapsible=icon]:pt-3">
              <SidebarGroupContent>
                <SidebarMenu selected={items.findIndex((item) => item.id === here)} travel={travel}>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        tooltip={item.title}
                        {...answers(item.id)}
                        render={<a href={`/${item.id}`} onClick={close} />}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                      {item.badge && (
                        <SidebarMenuBadge title="Cards waiting on you, with the checks due in your domains">
                          <Changed value={item.badge}>{item.badge}</Changed>
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            {/* Quiet links at the foot, as Efferd's sidebar has them: Help first, then Observability and
                Settings for admins and owners. */}
            <SidebarGroup className="mt-auto">
              <SidebarGroupContent>
                <SidebarMenu className="**:data-[sidebar=menu-button]:[&>span]:text-muted-foreground">
                  {/* One Help row: its menu holds the Help page, the keys, Documentation and the ways to reach a person. */}
                  <HelpMenu place={going} />
                  {/* What agents asked and got, for the same people as Settings. */}
                  {seesObservability(me) && (
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        tooltip="Observability"
                        {...answers('observability')}
                        render={<a href="/observability" onClick={close} />}
                      >
                        <ActivityIcon />
                        <span>Observability</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                  {/* Everyone: an admin for all of it, anyone else for the domains, the people in
                      the workspace and the agents they connected. */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip="Settings"
                      {...answers('settings')}
                      render={
                        <a
                          href={
                            me.admin ? '/settings' : `/settings/${landingOf(me.owns.length > 0)}`
                          }
                          onClick={close}
                        />
                      }
                    >
                      <SettingsIcon />
                      <span>Settings</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </>
      )}
      <SidebarFooter className="h-bar justify-center py-0 shadow-hairline-top">
        <NavUser />
      </SidebarFooter>
      <ResizeRail onWidth={onWidth} />
    </Sidebar>
  )
}
