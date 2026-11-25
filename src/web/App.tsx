import * as React from 'react'
import { Outlet } from '@tanstack/react-router'
import { QueryClientProvider, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { mockControls } from '@/api'
import { createQueryClient } from '@/api/query-client'
import {
  afterSomeoneElse,
  InDock,
  isPageQuery,
  laterQueries,
  sessionQuery,
  sharedQueries,
  useSession,
} from '@/api/queries'
import { AppSidebar } from '@/components/app-sidebar'
import { CommandPalette } from '@/components/command-palette'
import { ShortcutsDialog } from '@/components/shortcuts-dialog'
import { ReportDialog } from '@/components/report-dialog'
import { ErrorBoundary } from '@/components/error-boundary'
import { closeDock, DOCK_TITLE, returnFromDock, useDock } from '@/lib/dock'
import { DockFrame, DockWaiting } from '@/components/dock'
import { familyParts } from '@/components/footnote/family-parts'
import { reportParts } from '@/components/footnote/report-parts'
import { DockLeaving, pictureOf, setLeavingDock, useLeavingDock } from '@/components/dock-leaving'
import { useAfter } from '@/lib/loading'
import { DefinitionPeek } from '@/components/footnote/definition-peek'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster, useSonner } from '@/components/ui/sonner'
import { allFloors, floorUnder, useFloorsVersion } from '@/lib/toast-floor'
import { ShareChatPanel } from '@/components/footnote/share-chat'
import { WherePanel } from '@/components/footnote/where-panel'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { onOpen, open } from '@/lib/events'
import { clamp, readWidth, saveWidth } from '@/lib/pane-width'
import { navigate, redirectTo, useInAppLinks, useRoute } from '@/lib/router'
import { rememberSignedOut } from '@/lib/demo-profiles'
import { ThemeProvider } from '@/lib/theme'
import { AskDock, TryIt } from '@/pages/ask'
import { ReviewSheet } from '@/pages/review'
import { SignInPage } from '@/pages/signin'
import type { Shape } from '@/components/footnote/app-skeleton'

// The skeletons' shapes come with their own code (components/footnote/app-skeleton.tsx), fetched as
// the app starts: they show only after 150ms, by which time it is in.
const skeletons = import('@/components/footnote/app-skeleton')
const PageShape = React.lazy(() => skeletons.then((m) => ({ default: m.PageShape })))
const ShellShape = React.lazy(() => skeletons.then((m) => ({ default: m.ShellShape })))

/**
 * A lazy page's fallback, in the page's own shape: nothing for 150ms, so a chunk already fetched never
 * flashes a skeleton. The review: its list, the document and the side panel. An editor: the
 * toolbar row and the sheet on its canvas. Definitions: the header, the list's bars at their own
 * heights and its rows. Any other page (Observability, Settings, Help): its header and a
 * frame of rows. The documentation, outside the app's shell: its header, then its home or a page.
 */
export function Loading({ shape }: { shape: Shape }) {
  const shown = useAfter(true)
  if (!shown) return null
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={
        shape === 'docs-home' || shape === 'docs-page'
          ? 'min-h-svh bg-background'
          : 'flex h-full min-h-0 flex-col'
      }
    >
      <React.Suspense fallback={null}>
        <PageShape shape={shape} />
      </React.Suspense>
    </div>
  )
}

/** The whole app while its shared reads load, in its shape (ShellShape); nothing for 150ms. */
function ShellSkeleton() {
  const shown = useAfter(true)
  if (!shown) return null
  return (
    <React.Suspense fallback={null}>
      <ShellShape />
    </React.Suspense>
  )
}

// A topic's answer panel opens only from Observability, so it comes with that page's code
// (pages/observability) rather than the first load; its frame shows while that code loads.
const AnswerPanel = React.lazy(() =>
  import('@/pages/observability').then((m) => ({ default: m.AnswerPanel })),
)

// The conflict dock opens from a list, an answer or a card; its view comes with its own code.
const ConflictDock = React.lazy(() =>
  import('@/pages/conflicts').then((m) => ({ default: m.ConflictDock })),
)

// Something wrong? opens from Bad answer or More under an answer; its form comes with its own code.
const ReportPanel = React.lazy(() =>
  import('@/components/footnote/report-panel').then((m) => ({ default: m.ReportPanel })),
)

// A context item's quick view opens from a click, so its code is not on the first load: it is
// fetched once the browser is idle after the first page (main.tsx), before anything is clicked.
const FactPeek = React.lazy(() =>
  import('@/components/footnote/fact-peek').then((m) => ({ default: m.FactPeek })),
)

// A suggested family's panel opens only from the Names card, so its code comes when it opens.
const SuggestedFamilyPeek = React.lazy(() => import('@/components/footnote/suggested-family-peek'))

// Connect an agent is asked for now and then, so its dialog is not on the first load: its code is
// fetched with Settings, which shows the same body, once the browser is idle (main.tsx), and the
// dialog mounts the first time it is asked for.
const ConnectAgentDialog = React.lazy(() =>
  import('@/components/connect-agent').then((m) => ({ default: m.ConnectAgentDialog })),
)

function ConnectAgentOnOpen() {
  const [asked, setAsked] = React.useState(false)
  React.useEffect(() => onOpen('connect', () => setAsked(true)), [])
  return asked ? (
    <React.Suspense fallback={null}>
      <ConnectAgentDialog />
    </React.Suspense>
  ) : null
}

/** A screen behind its own error boundary, reset on every navigation, so one failure never blanks the app. */
function SafeScreen() {
  const { path } = useRoute()
  return (
    <ErrorBoundary key={path}>
      <Outlet />
    </ErrorBoundary>
  )
}

function SafeDock() {
  const dock = useDock()
  const title = dock ? DOCK_TITLE[dock.kind] : ''
  return (
    <ErrorBoundary
      key={`${dock?.kind}.${dock?.id}`}
      what="panel"
      frame={(body) => <DockFrame title={title}>{body}</DockFrame>}
    >
      <InDock.Provider value>
        <div
          className="h-full dock-swap"
          onKeyDown={(e) => {
            // A list row's peek closes on Escape from inside; a field, menu or dialog in it keeps its own Escape.
            if (e.key !== 'Escape' || e.defaultPrevented) return
            if (dock?.kind !== 'context' && dock?.kind !== 'def' && dock?.kind !== 'family') return
            if (
              (e.target as HTMLElement).closest(
                'input, textarea, [contenteditable], [role=menu], [role=listbox], [role=dialog]',
              )
            )
              return
            e.preventDefault()
            closeDock()
          }}
        >
          <DockContent />
        </div>
      </InDock.Provider>
    </ErrorBoundary>
  )
}

function DockContent() {
  const dock = useDock()
  if (!dock) return null
  switch (dock.kind) {
    case 'review':
      return (
        <React.Suspense fallback={<DockWaiting title={DOCK_TITLE.review} />}>
          <ReviewSheet cardId={dock.id!} />
        </React.Suspense>
      )
    case 'context':
      return (
        <React.Suspense fallback={<DockWaiting title={DOCK_TITLE.context} />}>
          <FactPeek id={dock.id!} />
        </React.Suspense>
      )
    case 'def':
      return <DefinitionPeek name={dock.id!} />
    case 'family':
      return (
        <React.Suspense fallback={<DockWaiting title={DOCK_TITLE.family} />}>
          <SuggestedFamilyPeek parts={familyParts} nameKey={dock.id!} />
        </React.Suspense>
      )
    case 'ask':
      return <AskDock />
    case 'try':
      return <TryIt cardId={dock.id} />
    case 'topic':
      return (
        <React.Suspense fallback={<DockWaiting title={DOCK_TITLE.topic} />}>
          <AnswerPanel id={dock.id!} />
        </React.Suspense>
      )
    case 'share':
      return <ShareChatPanel chat={dock.id ?? ''} />
    case 'report':
      return (
        <React.Suspense fallback={<DockWaiting title={DOCK_TITLE.report} />}>
          <ReportPanel id={dock.id!} parts={reportParts} />
        </React.Suspense>
      )
    case 'where':
      return <WherePanel id={dock.id!} />
    case 'conflict':
      return (
        <React.Suspense fallback={<DockWaiting title={DOCK_TITLE.conflict} />}>
          <ConflictDock pairKey={dock.id ?? ''} />
        </React.Suspense>
      )
  }
}

/** The app inside its shell: the sidebar, the page and the dock. Signed out, the sign-in page. */
export function AppShell() {
  const { user } = useSession()
  if (!user) return <SignInPage />
  return <Shell />
}

function Shell() {
  const dock = useDock()
  const isMobile = useIsMobile()
  const { parts } = useRoute()
  // Closed, the dock gives focus back to the list row it opened from.
  const dockOpen = !!dock
  React.useEffect(() => {
    if (!dockOpen) returnFromDock()
  }, [dockOpen])
  // A dock that closes leaves as a picture of itself over the page, which has already widened.
  const dockNode = React.useRef<HTMLDivElement | null>(null)
  const dockWidth = React.useRef(0)
  const dockScrolls = React.useRef(new Map<HTMLElement, [number, number]>())
  const leaving = useLeavingDock()
  React.useLayoutEffect(() => {
    const node = dockNode.current
    if (!dockOpen || !node || isMobile) return
    const watch = new ResizeObserver(([entry]) => {
      dockWidth.current = entry?.borderBoxSize?.[0]?.inlineSize ?? node.offsetWidth
    })
    dockWidth.current = node.offsetWidth
    watch.observe(node)
    // Scroll offsets are read while the panel is attached; once it is removed they read 0.
    const offsets = dockScrolls.current
    offsets.clear()
    const onScroll = (e: Event) => {
      if (e.target instanceof HTMLElement)
        offsets.set(e.target, [e.target.scrollTop, e.target.scrollLeft])
    }
    node.addEventListener('scroll', onScroll, true)
    return () => {
      watch.disconnect()
      node.removeEventListener('scroll', onScroll, true)
    }
  }, [dockOpen, dock?.width, isMobile])
  React.useLayoutEffect(() => {
    if (dockOpen) {
      setLeavingDock(null)
      return
    }
    // React clears the ref when the panel unmounts; the node itself keeps what it showed.
    const node = dockNode.current
    dockNode.current = null
    if (!node || isMobile || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    setLeavingDock(pictureOf(node, dockWidth.current, dockScrolls.current))
  }, [dockOpen, isMobile])
  // The sidebar folds to its rail while the dock is open or a review is on screen, and comes back
  // when they close. A page that loads that way starts folded, so nothing jumps after the first paint.
  const hasDock = !!dock || (parts[0] === 'inbox' && parts[2] === 'review')
  const [open, setOpen] = React.useState(!hasDock)
  // The left navigation's width, dragged on its rail, kept for the session.
  const [sidebarWidth, setSidebarWidth] = React.useState(() =>
    clamp(readWidth('sidebar', 256), 200, 360),
  )
  // The fold follows the dock in the same render as the dock itself, so the page reflows once, in one
  // frame, and that fold is instant (data-fold="auto"). Only a person's own fold animates.
  const [had, setHad] = React.useState(hasDock)
  const [before, setBefore] = React.useState<boolean | null>(hasDock ? true : null)
  const [auto, setAuto] = React.useState(false)
  if (had !== hasDock) {
    setHad(hasDock)
    setAuto(true)
    if (hasDock && before === null) {
      setBefore(open)
      setOpen(false)
    }
    if (!hasDock && before !== null) {
      setOpen(before)
      setBefore(null)
    }
  }

  React.useEffect(() => {
    if (!auto) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setAuto(false))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [auto])

  return (
    <SidebarProvider
      open={open}
      onOpenChange={(o) => {
        setAuto(false)
        setOpen(o)
      }}
      data-fold={auto ? 'auto' : undefined}
      className="h-svh overflow-clip"
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
    >
      {/* The first stop for the keyboard: past the sidebar, straight to the page. A button, since a #link would change the address. */}
      <button
        type="button"
        className="pointer-events-none fixed top-3 left-3 z-skip rounded-md bg-background px-3 py-2 text-sm font-medium opacity-0 shadow-md focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={() => {
          // A page can name where it starts (Ask: the box to ask in); otherwise the page itself.
          const main = document.querySelector<HTMLElement>('[data-slot=sidebar-inset]')
          const target = document.querySelector<HTMLElement>('[data-skip-target]') ?? main
          main?.setAttribute('tabindex', '-1')
          target?.focus()
        }}
      >
        Skip to the content
      </button>
      <AppSidebar
        onWidth={(w, done) => {
          const next = clamp(w, 200, 360)
          setSidebarWidth(next)
          if (done) saveWidth('sidebar', next)
        }}
      />
      <SidebarInset className="min-h-0 min-w-0 overflow-clip">
        {isMobile ? (
          <div className="h-full min-h-0">
            <SafeScreen />
          </div>
        ) : (
          // One group whether the dock is open or not: the page keeps its place, so opening a peek
          // keeps its search, filters, ticked rows and scroll.
          <ResizablePanelGroup orientation="horizontal" id="shell">
            <ResizablePanel id="page" minSize={360}>
              <SafeScreen />
            </ResizablePanel>
            {dock && <ResizableHandle withHandle />}
            {dock && (
              <ResizablePanel
                id={`dock-${dock.width}`}
                key={dock.width}
                defaultSize={clamp(readWidth(`dock-${dock.width}`, dock.width), 400, 960)}
                minSize={400}
                maxSize={960}
                groupResizeBehavior="preserve-pixel-size"
                onResize={(size) => saveWidth(`dock-${dock.width}`, size.inPixels)}
              >
                {/* The dock arrives: a 16px slide and a fade in 220ms; its content changing (peek to peek) only fades. */}
                <div
                  className="h-full dock-enter"
                  ref={(node) => {
                    if (node) dockNode.current = node
                  }}
                >
                  <SafeDock />
                </div>
              </ResizablePanel>
            )}
          </ResizablePanelGroup>
        )}
        {leaving && <DockLeaving picture={leaving} />}
        {isMobile && dock && (
          <div className="fixed inset-0 z-dock dock-enter bg-background">
            <SafeDock />
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}

/**
 * The mock binding plays the review flags in the address (?demo=, ?state=, ?slow=1 and the rest):
 * every move tells it where the app is. A flag that sets a fault starts the page's own load again;
 * one that changes the demo's world refreshes everything. The http binding has no flags.
 */
function ScenarioSync() {
  const { path, query } = useRoute()
  const queryClient = useQueryClient()
  const search = query.toString()
  React.useLayoutEffect(() => {
    if (!mockControls) return
    const changed = mockControls.setAddress({
      path,
      query: Object.fromEntries(new URLSearchParams(search)),
    })
    if (changed.fault) void queryClient.resetQueries({ predicate: (q) => isPageQuery(q.queryKey) })
    if (changed.data) void queryClient.invalidateQueries()
  }, [path, search, queryClient])
  return null
}

function Gate() {
  const { user } = useSession()
  const route = useRoute()
  useInAppLinks()
  React.useEffect(() => {
    // The documentation is a public site: it needs nobody signed in. An agent's consent page asks
    // a person who is not signed in to sign in there, and stays.
    if (!user && !['signin', 'docs', 'connect'].includes(route.parts[0] ?? '')) navigate('/signin')
    // Signed in, there is nobody to pick: a sign-in that just finished, or /signin opened again,
    // lands where the app opens (routes/index.tsx).
    if (user && route.parts[0] === 'signin') redirectTo('/')
    // Signed in again, so a later sign-out of the demo is a new one (lib/demo-profiles).
    if (user) rememberSignedOut(false)
  }, [user, route.parts])
  // ?open=palette, connect, shortcuts or report opens that overlay, so every state has a link.
  const overlay = route.query.get('open')
  React.useEffect(() => {
    if (
      overlay === 'palette' ||
      overlay === 'connect' ||
      overlay === 'shortcuts' ||
      overlay === 'report'
    )
      setTimeout(() => open(overlay), 0)
  }, [overlay])
  // The documentation, sign-in or the app in its shell (routes/).
  return <Outlet />
}

/**
 * The shared reads every screen uses (the session, the workspace, the library), loaded once before
 * the app is drawn, so a screen reads them from the cache and never waits. Until then the app shows
 * its own skeleton (ShellSkeleton), never a blank window. Signed out, only the session: the sign-in
 * page and the documentation need nothing else. A read that failed does not hold the app back: a
 * screen that needs it shows the failure in its own frame. The reviews start at the same time
 * and hold back only the Inbox, whose page they are (laterQueries).
 */
function Loaded({ children }: { children: React.ReactNode }) {
  const session = useQuery(sessionQuery())
  const signedIn = !!session.data?.user
  const rest = useQueries({
    queries: sharedQueries().map((q) => ({ ...q, enabled: signedIn })),
  })
  const later = useQueries({
    queries: laterQueries().map((q) => ({ ...q, enabled: signedIn })),
  })
  const { parts } = useRoute()
  // The sign-in page and an agent's consent page wait for the session alone; anything else waits
  // in the shape it will have.
  const waiting = ['signin', 'connect'].includes(parts[0] ?? '') ? null : <ShellSkeleton />
  // Opened at the Inbox, the shell waits for the reviews too, the page's own read: the page draws
  // with it, never later under a search or a click already started. Once drawn, the shell stays,
  // and a move to the Inbox waits in the page's own frame.
  const [drawn, setDrawn] = React.useState(false)
  const held = parts[0] === 'inbox' && !drawn ? [...rest, ...later] : rest
  if (!session.data) return waiting
  if (signedIn && held.some((q) => q.data === undefined && !q.isError)) return waiting
  if (signedIn && !drawn) setDrawn(true)
  return children
}

/** How far a toast sits from the window's right and bottom edges, and above a floor, in px. */
const TOAST_EDGE = 16
const TOAST_ABOVE = 8

/**
 * Toasts sit in the bottom right corner, and never cover what is at the foot of the window under
 * them: a card's decisions, a list's count or selection bar, the Ask box (`useToastFloor`). Then
 * they sit just above it. In the review a narrower toast stays inside the decision's column.
 */
function AppToaster() {
  const { parts } = useRoute()
  const review = parts[0] === 'inbox' && parts[2] === 'review'
  const width = review ? 300 : 356
  const shown = useSonner().toasts.length > 0
  const floors = useFloorsVersion()
  const [lift, setLift] = React.useState(0)
  React.useLayoutEffect(() => {
    if (!shown) return
    // Sonner gives a phone (under 600px) the whole width.
    const measure = () => {
      const w = window.innerWidth
      const left = w < 600 ? 0 : w - TOAST_EDGE - width
      setLift(floorUnder({ left, right: w }))
    }
    measure()
    const sizes = new ResizeObserver(measure)
    for (const el of allFloors()) {
      sizes.observe(el)
      el.addEventListener('transitionend', measure)
    }
    window.addEventListener('resize', measure)
    return () => {
      sizes.disconnect()
      for (const el of allFloors()) el.removeEventListener('transitionend', measure)
      window.removeEventListener('resize', measure)
    }
  }, [shown, floors, width])
  const bottom = lift ? lift + TOAST_ABOVE : TOAST_EDGE
  return (
    <Toaster
      position="bottom-right"
      offset={{ bottom, right: TOAST_EDGE }}
      mobileOffset={{ bottom, left: TOAST_EDGE, right: TOAST_EDGE }}
      style={{ '--width': `${width}px` } as React.CSSProperties}
    />
  )
}

const queryClient = createQueryClient({
  // A session that ended: everything cached was the person's, and the sign-in page comes next.
  onSignedOut: () => void queryClient.invalidateQueries({ queryKey: sessionQuery().queryKey }),
  // Another tab signed this browser in as someone else: the app moves to them.
  onSomeoneElse: () => void afterSomeoneElse(queryClient),
})

/** The theme, which a new ?theme= in the address switches to, as it does on load. */
function AddressTheme({ children }: { children: React.ReactNode }) {
  return <ThemeProvider asked={useRoute().query.get('theme')}>{children}</ThemeProvider>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AddressTheme>
        <TooltipProvider>
          <ScenarioSync />
          <Loaded>
            <Gate />
            <SignedIn>
              <CommandPalette />
              <ConnectAgentOnOpen />
              <ShortcutsDialog />
              <ReportDialog />
            </SignedIn>
          </Loaded>
          <AppToaster />
        </TooltipProvider>
      </AddressTheme>
    </QueryClientProvider>
  )
}

/** What only someone signed in sees: the overlays over the app. */
function SignedIn({ children }: { children: React.ReactNode }) {
  const { user } = useSession()
  return user ? children : null
}
