import * as React from 'react'

/**
 * Command (or Control) and Enter presses the page's primary button, the one marked data-primary:
 * Publish, Send or Save. A blocked button then shows what is missing, as a click would. A box that
 * takes the keys for its own button, as Draft from text's does, has them instead.
 */
export function usePrimaryKey() {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.defaultPrevented) return
      const button = document.querySelector<HTMLButtonElement>('button[data-primary]')
      if (!button) return
      e.preventDefault()
      button.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
