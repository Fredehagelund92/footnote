/*
  The ground's moving part, on the landing page and in the docs (shared/Ground.astro): now and
  then a footnote mark lands on a dot of the paper, numbered like the notes on a page. The dots
  around it light up in a widening ring, and a dotted leader runs from it toward the page, as a
  note points at its line; then it all fades. It draws on one canvas only while a mark is landing,
  rests while the tab is hidden, and never runs with reduced motion. The dots it lights are the
  dot field's own (shared/chrome.css): 28 px apart, fixed to the window.
*/

export type Area = { left: number; top: number; right: number; bottom: number }

export type GroundOptions = {
  /** Where marks may land, in the window's coordinates: the paper around the page. */
  areas: () => Area[]
  /** The wait between two landings, in milliseconds: the shortest and the longest. */
  every: readonly [number, number]
  /** How bright the lit dots are, at their brightest. */
  strength: number
}

const pitch = 28
const duration = 3400
const reach = 4.5 * pitch
// The dot field fades in over the top and bottom of the window; marks land inside that.
const edge = 150

type Mark = { x: number; y: number; t0: number; n: number; area: Area; toward: -1 | 1 }

const ease = (t: number) => 1 - (1 - t) ** 3
const inside = (x: number, y: number, area: Area) =>
  x > area.left && x < area.right && y > area.top && y < area.bottom

export function ground({ areas, every, strength }: GroundOptions) {
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  if (still.matches) return
  const canvas = document.createElement('canvas')
  canvas.className = 'ground'
  canvas.setAttribute('aria-hidden', 'true')
  document.body.prepend(canvas)
  const context = canvas.getContext('2d')
  if (!context) return
  const ctx = context

  let width = 0
  let height = 0
  let count = 0
  let frame = 0
  let timer = 0
  let off = false
  const marks: Mark[] = []

  function size() {
    const ratio = Math.min(devicePixelRatio || 1, 2)
    width = innerWidth
    height = innerHeight
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  }

  /** A dot of the field, inside an area and away from the window's faded edges. */
  function pick(now: number): Mark | undefined {
    const dots: [number, number, Area][] = []
    for (const area of areas())
      for (let x = pitch; x < width; x += pitch)
        for (let y = Math.ceil(edge / pitch) * pitch; y < height - edge; y += pitch)
          if (inside(x, y, area) && !marks.some((m) => Math.hypot(m.x - x, m.y - y) < reach * 2))
            dots.push([x, y, area])
    const dot = dots[Math.floor(Math.random() * dots.length)]
    if (!dot) return undefined
    const [x, y, area] = dot
    // The leader runs toward the middle of the window, where the page is.
    const toward = x < width / 2 ? 1 : -1
    count = (count % 9) + 1
    return { x, y, t0: now, n: count, area, toward }
  }

  function draw(now: number) {
    frame = 0
    ctx.clearRect(0, 0, width, height)
    const css = getComputedStyle(document.documentElement)
    const ink = css.getPropertyValue('--ink').trim()
    const blue = css.getPropertyValue('--mark').trim()
    for (let i = marks.length - 1; i >= 0; i--) {
      const mark = marks[i]!
      const t = (now - mark.t0) / duration
      if (t >= 1) {
        marks.splice(i, 1)
        continue
      }
      const fade = 1 - Math.max(0, (t - 0.6) / 0.4)
      // The ring.
      const ring = ease(Math.min(t / 0.75, 1)) * reach
      ctx.fillStyle = ink
      for (let x = mark.x - reach; x <= mark.x + reach; x += pitch)
        for (let y = mark.y - reach; y <= mark.y + reach; y += pitch) {
          const d = Math.hypot(x - mark.x, y - mark.y)
          if (d > reach || d === 0 || !inside(x, y, mark.area)) continue
          const w = Math.max(0, 1 - Math.abs(d - ring) / (pitch * 1.1)) * (1 - (d / reach) * 0.6)
          if (w * fade <= 0.02) continue
          ctx.globalAlpha = w * fade * strength
          ctx.beginPath()
          ctx.arc(x, y, 1.2 + w * 1.4, 0, Math.PI * 2)
          ctx.fill()
        }
      // The leader: the dots between the mark and the page light up one after another.
      ctx.fillStyle = blue
      for (let step = 1; ; step++) {
        const x = mark.x + mark.toward * step * pitch
        if (!inside(x, mark.y, mark.area)) break
        const lit = Math.min(1, Math.max(0, (t - 0.12 - step * 0.05) / 0.12))
        if (lit <= 0) break
        ctx.globalAlpha = lit * fade * strength * 0.9
        ctx.beginPath()
        ctx.arc(x, mark.y, 1.6, 0, Math.PI * 2)
        ctx.fill()
      }
      // The mark and its number.
      const shown = Math.min(1, t / 0.12) * fade
      ctx.globalAlpha = shown
      ctx.beginPath()
      ctx.arc(mark.x, mark.y, 2.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = 'italic 500 17px "Source Serif 4", Georgia, serif'
      ctx.fillText(String(mark.n), mark.x + 4, mark.y - 5 - (1 - shown) * 4)
    }
    ctx.globalAlpha = 1
    if (marks.length) frame = requestAnimationFrame(draw)
  }

  function land() {
    timer = 0
    if (document.hidden) return
    const mark = pick(performance.now())
    if (mark) {
      marks.push(mark)
      if (!frame) frame = requestAnimationFrame(draw)
    }
    later()
  }

  function later(wait = every[0] + Math.random() * (every[1] - every[0])) {
    if (off) return
    clearTimeout(timer)
    timer = window.setTimeout(land, wait)
  }

  function stop() {
    clearTimeout(timer)
    timer = 0
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    marks.length = 0
    ctx.clearRect(0, 0, width, height)
  }

  size()
  addEventListener('resize', size)
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : later()))
  still.addEventListener('change', () => {
    if (!still.matches) return
    off = true
    stop()
    canvas.remove()
  })
  later(900)
}
