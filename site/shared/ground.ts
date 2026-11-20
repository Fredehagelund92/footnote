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

/*
  The landing page's first screen draws the ground itself (landing/pages/index.astro): one canvas
  holds the dots of both halves, the paper's and the terminal's, so they can answer. Under the
  pointer the dots swell and turn blue, and a dotted leader with a moving bead runs along the grid
  from the pointer to the note on the seam; when the note lands or changes, a wave runs out from it
  across both halves, blue on the paper and highlighter yellow on the terminal; a press on an empty
  spot sends a small ring; and now and then a numbered mark lands and points at the note, as above.
  No dot is lit behind text. It draws only while something moves, rests while the tab is hidden,
  and is never made with reduced motion, so the still dots of the stylesheet stay.
*/

export type Field = {
  /** The opening has played: the note has landed. */
  landed: () => void
  /** What is written changed, so the note did: a faint wave when nothing is written. */
  changed: (faint: boolean) => void
  /** An animation ended, so the layout is final: measure the holes again. */
  settled: () => void
}

type Dot = { x: number; y: number; term: boolean; hole: boolean }
type Wave = { x: number; y: number; reach: number; dur: number; k: number; t0: number }
type FieldMark = { x: number; y: number; t0: number; n: number; term: boolean; to: -1 | 1 }
type Pointer = { x: number; y: number; t0: number; out: number }
type Box = { l: number; t: number; r: number; b: number; x: number; y: number }

const lens = 150
const TAU = Math.PI * 2

export function field(hero: HTMLElement): Field | undefined {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return undefined
  const ctx = context
  canvas.className = 'field'
  canvas.setAttribute('aria-hidden', 'true')
  hero.prepend(canvas)
  hero.classList.add('field-on')

  const narrow = matchMedia('(max-width: 900px)')
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  let off = false
  const P = pitch
  let W = 0
  let H = 0
  let cols = 0
  let frame = 0
  let timer = 0
  let count = 0
  let dots: Dot[] = []
  let again = 0
  const waves: Wave[] = []
  const marks: FieldMark[] = []
  let ptr: Pointer | null = null
  let seamX: number | null = null
  let seamY: number | null = null
  let note: Box = { l: 0, t: 0, r: 0, b: 0, x: 0, y: 0 }
  let col = { paper: '', term: '', lp: '', lt: '', wt: '' }

  const at = (x: number, y: number) => {
    const i = Math.round((x - P / 2) / P)
    const j = Math.round((y - P / 2) / P)
    return i < 0 || i >= cols || j < 0 ? undefined : dots[j * cols + i]
  }
  const snap = (v: number) => Math.round((v - P / 2) / P) * P + P / 2

  function measure() {
    if (off) return
    const box = hero.getBoundingClientRect()
    const k = Math.min(devicePixelRatio || 1, 2)
    const css = getComputedStyle(document.documentElement)
    W = Math.round(box.width)
    H = Math.round(box.height)
    if (canvas.width !== W * k || canvas.height !== H * k) {
      canvas.width = W * k
      canvas.height = H * k
    }
    ctx.setTransform(k, 0, 0, k, 0, 0)
    const dark = document.documentElement.dataset.theme === 'dark'
    col = {
      paper: dark ? 'rgba(232,235,242,.1)' : 'rgba(21,25,34,.13)',
      term: 'rgba(230,233,240,.12)',
      lp: css.getPropertyValue('--mark').trim(),
      lt: css.getPropertyValue('--mark-t').trim(),
      wt: css.getPropertyValue('--hl-solid').trim(),
    }
    const agent = hero.querySelector('.pane.agent')
    if (narrow.matches && agent) {
      seamX = null
      seamY = agent.getBoundingClientRect().top - box.top
      hero.style.setProperty('--seam-y', `${Math.round(seamY)}px`)
    } else {
      seamX = W / 2
      seamY = null
    }
    // The holes: every line of text, the note, the buttons, with a margin.
    const holes: [number, number, number, number][] = []
    const range = document.createRange()
    const add = (r: DOMRect, px: number, py: number) => {
      if (r.width && r.height)
        holes.push([
          r.left - box.left - px,
          r.top - box.top - py,
          r.right - box.left + px,
          r.bottom - box.top + py,
        ])
    }
    hero
      .querySelectorAll<HTMLElement>('h1 span, .who, .pane [data-s] > *, .hero-foot .meta')
      .forEach((el) => {
        if (!el.offsetParent) return
        range.selectNodeContents(el)
        for (const r of range.getClientRects()) add(r, 12, 7)
      })
    hero.querySelectorAll<HTMLElement>('.seam, .tabs, .hero-foot .cta').forEach((el) => {
      if (el.offsetParent) add(el.getBoundingClientRect(), 12, 12)
    })
    const s = hero.querySelector('.seam')?.getBoundingClientRect()
    if (s)
      note = {
        l: s.left - box.left,
        t: s.top - box.top,
        r: s.right - box.left,
        b: s.bottom - box.top,
        x: (s.left + s.right) / 2 - box.left,
        y: (s.top + s.bottom) / 2 - box.top,
      }
    dots = []
    cols = Math.ceil((W - P / 2) / P)
    for (let y = P / 2; y < H; y += P)
      for (let i = 0; i < cols; i++) {
        const x = P / 2 + i * P
        dots.push({
          x,
          y,
          term: seamX !== null ? x > seamX : y > (seamY ?? 0),
          hole: holes.some((h) => x > h[0] && x < h[2] && y > h[1] && y < h[3]),
        })
      }
    if (frame) cancelAnimationFrame(frame)
    draw(performance.now())
  }

  /** From the pointer to the note: along its row, then along the column beside the note. */
  function leader(p: Pointer) {
    const sx = snap(p.x)
    const sy = snap(p.y)
    const path: [number, number][] = []
    if (sx > note.l - 14 && sx < note.r + 14 && sy > note.t - 14 && sy < note.b + 14) return path
    if (sy > note.t && sy < note.b) {
      if (sx < note.l) for (let x = sx; x < note.l - 12; x += P) path.push([x, sy])
      else for (let x = sx; x > note.r + 12; x -= P) path.push([x, sy])
    } else if (sx > note.l && sx < note.r) {
      if (sy < note.t) for (let y = sy; y < note.t - 12; y += P) path.push([sx, y])
      else for (let y = sy; y > note.b + 12; y -= P) path.push([sx, y])
    } else {
      const tx =
        sx < note.l
          ? Math.floor((note.l - 16 - P / 2) / P) * P + P / 2
          : Math.ceil((note.r + 16 - P / 2) / P) * P + P / 2
      const ty = snap(note.y)
      for (let x = sx; x !== tx; x += tx > sx ? P : -P) path.push([x, sy])
      for (let y = sy; y !== ty; y += ty > sy ? P : -P) path.push([tx, y])
      path.push([tx, ty])
    }
    return path
  }

  function dot(x: number, y: number, r: number, color: string, alpha: number) {
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fill()
  }

  function draw(now: number) {
    frame = 0
    ctx.clearRect(0, 0, W, H)
    let pk = 0
    if (ptr) {
      pk = ptr.out ? Math.max(0, 1 - (now - ptr.out) / 380) : Math.min(1, (now - ptr.t0) / 160)
      if (ptr.out && pk <= 0) ptr = null
    }
    for (let i = waves.length - 1; i >= 0; i--)
      if (now - waves[i]!.t0 >= waves[i]!.dur) waves.splice(i, 1)
    for (let i = marks.length - 1; i >= 0; i--)
      if (now - marks[i]!.t0 >= duration) marks.splice(i, 1)

    // The still dots of both halves.
    ctx.globalAlpha = 1
    for (const term of [false, true]) {
      ctx.fillStyle = term ? col.term : col.paper
      ctx.beginPath()
      for (const d of dots)
        if (d.term === term) {
          ctx.moveTo(d.x + 1.15, d.y)
          ctx.arc(d.x, d.y, 1.15, 0, TAU)
        }
      ctx.fill()
    }

    // The lens under the pointer, and the waves.
    if (ptr || waves.length)
      for (const d of dots) {
        if (d.hole) continue
        let w = 0
        let c = d.term ? col.lt : col.lp
        if (ptr) {
          const q = Math.hypot(d.x - ptr.x, d.y - ptr.y)
          if (q < lens) w = pk * (1 - q / lens) ** 2
        }
        for (const v of waves) {
          const t = (now - v.t0) / v.dur
          if (t < 0) continue
          const ww =
            Math.max(
              0,
              1 - Math.abs(Math.hypot(d.x - v.x, d.y - v.y) - ease(t) * v.reach) / (P * 1.7),
            ) *
            (1 - t) *
            v.k
          if (ww > w) {
            w = ww
            c = d.term ? col.wt : col.lp
          }
        }
        if (w > 0.03) dot(d.x, d.y, 1.15 + w * 2.5, c, Math.min(1, 0.22 + w))
      }

    // The leader from the pointer to the note, on a wide screen.
    if (ptr && seamX !== null) {
      const path = leader(ptr)
      const bead = (now / 62) % (path.length + 9)
      path.forEach(([x, y], n) => {
        const o = at(x, y)
        if (!o || o.hole) return
        const near = Math.max(0, 1 - Math.abs(n - bead) / 2.4)
        dot(x, y, 1.7 + near * 1.5, o.term ? col.lt : col.lp, pk * (0.5 + 0.5 * near))
      })
      const here = at(snap(ptr.x), snap(ptr.y))
      if (here && !here.hole) dot(here.x, here.y, 4.8, here.term ? col.lt : col.lp, pk)
    }

    // The marks that land: a ring, a leader toward the note, the mark and its number.
    for (const m of marks) {
      const t = (now - m.t0) / duration
      const fade = 1 - Math.max(0, (t - 0.6) / 0.4)
      const ring = ease(Math.min(t / 0.75, 1)) * reach
      const c = m.term ? col.lt : col.lp
      for (let x = m.x - 5 * P; x <= m.x + 5 * P; x += P)
        for (let y = m.y - 5 * P; y <= m.y + 5 * P; y += P) {
          const o = at(x, y)
          const q = Math.hypot(x - m.x, y - m.y)
          if (!o || o.hole || o.x !== x || !q || q > reach) continue
          const w = Math.max(0, 1 - Math.abs(q - ring) / (P * 1.1)) * (1 - (q / reach) * 0.6) * fade
          if (w > 0.03) dot(x, y, 1.2 + w * 1.5, c, w * 0.9)
        }
      for (let step = 1; step < 40; step++) {
        const lx = m.x + m.to * step * P
        const lo = at(lx, m.y)
        const lit = Math.min(1, Math.max(0, (t - 0.12 - step * 0.045) / 0.12))
        if (!lo || lo.x !== lx || lit <= 0 || (lx > note.l - 12 && lx < note.r + 12)) break
        if (!lo.hole) dot(lx, m.y, 1.7, c, lit * fade * 0.9)
      }
      const shown = Math.min(1, t / 0.12) * fade
      dot(m.x, m.y, 3, c, shown)
      ctx.font = 'italic 500 17px "Source Serif 4", Georgia, serif'
      ctx.fillText(String(m.n), m.x + 6, m.y - 6 - (1 - shown) * 4)
    }
    ctx.globalAlpha = 1
    if (ptr || waves.length || marks.length) kick()
  }

  function kick() {
    if (!frame && !off) frame = requestAnimationFrame(draw)
  }

  function wave(x: number, y: number, far: number, dur: number, k: number) {
    waves.push({ x, y, reach: far, dur, k, t0: performance.now() })
    kick()
  }
  const fromNote = (k: number) => wave(note.x, note.y, Math.max(W, H) * 0.62, 1700, k)

  function land() {
    timer = 0
    if (off) return
    const box = hero.getBoundingClientRect()
    if (!document.hidden && box.bottom > 120 && dots.length)
      for (let tries = 0; tries < 30; tries++) {
        const d = dots[Math.floor(Math.random() * dots.length)]!
        if (
          d.hole ||
          d.x < 3 * P ||
          d.x > W - 3 * P ||
          d.y < 4 * P ||
          d.y > H - 3 * P ||
          Math.abs(d.x - note.x) < (note.r - note.l) / 2 + 3 * P
        )
          continue
        if (ptr && Math.hypot(d.x - ptr.x, d.y - ptr.y) < lens) continue
        count = (count % 9) + 1
        marks.push({
          x: d.x,
          y: d.y,
          t0: performance.now(),
          n: count,
          term: d.term,
          to: d.x < note.x ? 1 : -1,
        })
        kick()
        break
      }
    later()
  }
  function later(wait = 5200 + Math.random() * 4200) {
    if (off) return
    clearTimeout(timer)
    timer = window.setTimeout(land, wait)
  }

  hero.addEventListener('pointermove', (e) => {
    if (off || e.pointerType === 'touch') return
    const box = hero.getBoundingClientRect()
    ptr = {
      x: e.clientX - box.left,
      y: e.clientY - box.top,
      t0: ptr && !ptr.out ? ptr.t0 : performance.now(),
      out: 0,
    }
    kick()
  })
  hero.addEventListener('pointerleave', () => {
    if (ptr && !off) {
      ptr.out = performance.now()
      kick()
    }
  })
  hero.addEventListener('pointerdown', (e) => {
    if (off || (e.target instanceof Element && e.target.closest('a, button'))) return
    const box = hero.getBoundingClientRect()
    wave(e.clientX - box.left, e.clientY - box.top, 6 * P, 950, 0.95)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer)
    else later()
  })
  still.addEventListener('change', () => {
    if (!still.matches) return
    off = true
    clearTimeout(timer)
    if (frame) cancelAnimationFrame(frame)
    cancelAnimationFrame(again)
    frame = 0
    ptr = null
    waves.length = 0
    marks.length = 0
    canvas.remove()
    hero.classList.remove('field-on')
  })
  new MutationObserver(measure).observe(document.documentElement, {
    attributeFilter: ['data-theme'],
  })
  addEventListener('resize', () => {
    cancelAnimationFrame(again)
    again = requestAnimationFrame(measure)
  })
  void document.fonts.ready.then(measure)
  addEventListener('load', measure)
  measure()
  later(7500)

  return {
    landed() {
      if (off) return
      measure()
      fromNote(1)
    },
    changed(faint) {
      if (off) return
      measure()
      fromNote(faint ? 0.4 : 1)
    },
    settled: measure,
  }
}
