// App-wide overlays opened from anywhere: the search palette, the Connect an agent dialog, the
// keyboard shortcuts and Report a problem.

export type Overlay = 'palette' | 'connect' | 'shortcuts' | 'report'

export function open(overlay: Overlay) {
  window.dispatchEvent(new CustomEvent('footnote:open', { detail: overlay }))
}

export function onOpen(overlay: Overlay, run: () => void) {
  const listener = (e: Event) => {
    if ((e as CustomEvent<Overlay>).detail === overlay) run()
  }
  window.addEventListener('footnote:open', listener)
  return () => window.removeEventListener('footnote:open', listener)
}
