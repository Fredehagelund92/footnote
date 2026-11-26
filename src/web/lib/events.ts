// App-wide overlays opened from anywhere: the search palette, the Connect an agent dialog, the
// keyboard shortcuts and Report a problem. Search can open on words, handed over in memory and
// never through an address.

export type Overlay = 'palette' | 'connect' | 'shortcuts' | 'report'

export function open(overlay: Overlay, words?: string) {
  window.dispatchEvent(new CustomEvent('footnote:open', { detail: { overlay, words } }))
}

export function onOpen(overlay: Overlay, run: (words?: string) => void) {
  const listener = (e: Event) => {
    const { detail } = e as CustomEvent<{ overlay: Overlay; words?: string }>
    if (detail.overlay === overlay) run(detail.words)
  }
  window.addEventListener('footnote:open', listener)
  return () => window.removeEventListener('footnote:open', listener)
}
