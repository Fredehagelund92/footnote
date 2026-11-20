import { field } from '../shared/ground.ts'

/*
  The landing page's first screen (landing/pages/index.astro). The opening plays once, when the
  fonts are in, so every stroke lands on final line breaks: the person asks, the agent asks and
  guesses, the guess is struck, the note drops onto the seam, and both read it. Dotted leaders run
  from each mark to its note, at right angles with rounded bends, and are drawn again when the
  layout or the state changes. The three buttons switch what is written: Checked, Conflict and Not
  found, a tab list with the arrow keys, Home and End. With reduced motion nothing plays: the page
  opens on the finished state (the `anim` class is never set), and the ground stays still.
*/

export function hero(root: HTMLElement) {
  const wires = root.querySelector<SVGSVGElement>('.wires')
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')]
  const narrow = matchMedia('(max-width: 900px)')
  const ground = field(root)

  function bend(x1: number, y1: number, x2: number, y2: number, tall: boolean, off: number) {
    const r = 10
    const d = `M${x1},${y1}`
    if (tall) {
      if (Math.abs(x2 - x1) < 2) return `${d} V${y2}`
      const my = Math.round((y1 + y2) / 2) + off
      const sx = x2 > x1 ? 1 : -1
      const sy = y2 > y1 ? 1 : -1
      const k = Math.min(r, Math.abs(x2 - x1) / 2)
      return `${d} V${my - sy * k} Q${x1},${my} ${x1 + sx * k},${my} H${x2 - sx * k} Q${x2},${my} ${x2},${my + sy * k} V${y2}`
    }
    if (Math.abs(y2 - y1) < 2) return `${d} H${x2}`
    const mx = x2 + off
    const s = x2 > x1 ? 1 : -1
    const t = y2 > y1 ? 1 : -1
    const q = Math.max(0, Math.min(r, Math.abs(y2 - y1) / 2, Math.abs(x1 - mx), Math.abs(x2 - mx)))
    return `${d} H${mx - s * q} Q${mx},${y1} ${mx},${y1 + t * q} V${y2 - t * q} Q${mx},${y2} ${mx + s * q},${y2} H${x2}`
  }

  function draw() {
    if (!wires) return
    const box = root.getBoundingClientRect()
    const tall = narrow.matches
    const seen = { p: 0, a: 0 }
    let out = ''
    for (const mark of root.querySelectorAll<HTMLElement>('.pane .fm[data-to]')) {
      if (!mark.offsetParent) continue
      const card = root.querySelector<HTMLElement>(`[data-anchor="${mark.dataset.to}"]`)
      if (!card?.offsetParent) continue
      const a = mark.getBoundingClientRect()
      const c = card.getBoundingClientRect()
      const person = !!mark.closest('.person')
      let x1: number, y1: number, x2: number, y2: number
      if (tall) {
        x1 = a.left + a.width / 2
        y1 = person ? a.bottom + 4 : a.top - 4
        x2 = person ? c.left + 39 : x1
        y2 = person ? c.top - 5 : c.bottom + 5
      } else {
        x1 = person ? a.right + 5 : a.left - 5
        y1 = a.top + a.height / 2
        x2 = person ? c.left - 6 : c.right + 6
        y2 = c.top + Math.min(37, c.height / 2)
      }
      const off = (18 + (person ? seen.p++ : seen.a++) * 11) * (person ? -1 : 1)
      const at = (v: number, o: number) => Math.round(v - o)
      out += `<path class="${person ? 'p' : 'a'}" d="${bend(at(x1, box.left), at(y1, box.top), at(x2, box.left), at(y2, box.top), tall, tall ? 0 : off)}"/>`
    }
    wires.innerHTML = out
  }

  function pick(tab: HTMLButtonElement) {
    for (const t of tabs) {
      const on = t === tab
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1
    }
    root.dataset.state = tab.dataset.go
    draw()
  }

  function go(tab: HTMLButtonElement, focus = false) {
    root.classList.remove('play')
    root.classList.add('done', 'swap')
    pick(tab)
    if (focus) tab.focus()
    const live = root.querySelector('#state-live')
    const shown = root.querySelector(`.person [data-s="${root.dataset.state}"]`)
    if (live && shown)
      live.textContent = [
        shown.querySelector('.ask')?.textContent,
        shown.querySelector('.state-line')?.textContent,
      ].join(' ')
    ground?.changed(root.dataset.state === 'missing')
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => go(tab))
    tab.addEventListener('keydown', (e) => {
      const n =
        e.key === 'ArrowRight'
          ? i + 1
          : e.key === 'ArrowLeft'
            ? i - 1
            : e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? tabs.length - 1
                : null
      if (n === null) return
      e.preventDefault()
      go(tabs[(n + tabs.length) % tabs.length]!, true)
    })
  })

  let settle = 0
  root.addEventListener('animationend', () => {
    cancelAnimationFrame(settle)
    settle = requestAnimationFrame(() => {
      draw()
      ground?.settled()
    })
  })
  addEventListener('resize', draw)
  addEventListener('load', draw)
  draw()

  void document.fonts.ready.then(() => {
    draw()
    if (!document.documentElement.classList.contains('anim') || root.classList.contains('done'))
      return
    requestAnimationFrame(() => {
      root.classList.add('play')
      // The note lands 2.15 s into the opening; the wave runs out from it as it settles.
      setTimeout(() => ground?.landed(), 2500)
    })
  })
}
