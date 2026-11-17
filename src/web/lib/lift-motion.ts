/** A CSS time in milliseconds: the build writes 220ms as .22s. */
const msOf = (time: string) => parseFloat(time) * (time.trim().endsWith('ms') ? 1 : 1000)

/**
 * The docked box moving to its place from where it was, under the question: in `--dur-3` on
 * `--ease-move` (docs/design/motion.md). Loaded once the box is lifted, so the first page doesn't carry it.
 */
export function dockFrom(el: HTMLElement, from: number) {
  const style = getComputedStyle(el)
  el.animate(
    [
      { transform: `translateY(${from - el.getBoundingClientRect().top}px)` },
      { transform: 'none' },
    ],
    {
      duration: msOf(style.getPropertyValue('--dur-3')),
      easing: style.getPropertyValue('--ease-move'),
    },
  )
}
