import { field, type Field } from '../shared/ground.ts'

/*
  The landing page's first screen (landing/components/AskWindow.astro). Once, when the fonts are
  in, the Norway question types itself into the box and sends itself: the agent's own guess shows
  and is struck, get_context is called, the checked answer arrives, and a dotted leader runs from
  its number to the note it came from. Pressing a question, or typing one, plays its answer. Plain
  rules match a typed question to one of the four, as in the product no model reads it, and
  anything else is told that nothing is written. With reduced motion nothing plays: the page opens
  on Norway's answer, finished (the `anim` class is never set), and the ground stays still.
*/

// Plain rules pick the answer, as in the product: no model reads the question.
const rules: [string, RegExp][] = [
  ['norway', /norway|norge|norwegian/],
  ['germany', /german|deutsch|yesterday|\blag|late/],
  ['uk', /kingdom|\buk\b|britain|british|store credit|gift card|counted/],
  ['sweden', /sweden|swedish|returns|2023/],
]
const matchOf = (text: string) => {
  const t = text.toLowerCase()
  return rules.find(([, rule]) => rule.test(t))?.[0] ?? 'none'
}

export function hero(root: HTMLElement) {
  const win = root.querySelector<HTMLElement>('#win')!
  const panel = root.querySelector<HTMLElement>('#notes')!
  const title = root.querySelector<HTMLElement>('#panel-title')!
  const wires = root.querySelector<SVGSVGElement>('#wires')!
  const live = root.querySelector<HTMLElement>('#answer-live')!
  const form = root.querySelector<HTMLFormElement>('#ask')!
  const input = root.querySelector<HTMLInputElement>('#q')!
  const picks = [...root.querySelectorAll<HTMLButtonElement>('#try button')]
  const threads = [...root.querySelectorAll<HTMLElement>('.thread')]
  const reads = [...root.querySelectorAll<HTMLElement>('.panel .read')]
  const moving = document.documentElement.classList.contains('anim')
  const wide = matchMedia('(min-width: 901px)')
  const ground: Field | undefined = moving ? field(root, { target: win, panel }) : undefined
  let timers: number[] = []
  let shown = 'norway'

  const thread = () => threads.find((t) => t.dataset.a === shown)!
  const read = () => reads.find((r) => r.dataset.a === shown)!

  /** Shows one answer: at once, played step by step, or laid out hidden to play later. */
  function show(key: string, asked: string | null, how: 'now' | 'play' | 'hold') {
    for (const t of timers) clearTimeout(t)
    timers = []
    win.classList.remove('wired')
    wires.innerHTML = ''
    shown = key
    for (const c of picks) c.setAttribute('aria-pressed', String(c.dataset.a === key))
    for (const t of threads) t.hidden = t.dataset.a !== key
    for (const r of reads) r.hidden = r.dataset.a !== key
    const q = thread().querySelector<HTMLElement>('.q')!
    q.textContent = asked ?? q.dataset.question ?? ''
    title.textContent = panel.dataset.title = read().dataset.title ?? ''
    for (const s of steps()) s.classList.remove('on')
    // Read out as the question, then its line: "Conflict: Two items say different things."
    const state = [...(thread().querySelector('.state')?.children ?? [])]
    live.textContent = `${q.textContent} ${state.map((part) => part.textContent?.trim()).join(': ')}.`
    if (how === 'now' || !moving) reveal(true)
    else if (how === 'play') reveal(false)
  }

  const steps = () => [
    ...thread().querySelectorAll<HTMLElement>('.step'),
    ...read().querySelectorAll<HTMLElement>('.step'),
  ]

  function landed() {
    draw()
    win.classList.add('wired')
    ground?.changed(!read().querySelector('.note:not(.none)'))
  }

  function reveal(atOnce: boolean) {
    const all = steps()
    if (atOnce) {
      for (const s of all) s.classList.add('on')
      landed()
      return
    }
    let at = 0
    all.forEach((s, i) => {
      at += i === 0 ? 0 : i === 1 ? 380 : 130
      timers.push(window.setTimeout(() => s.classList.add('on'), at))
      if (s.classList.contains('guess')) at += 1500
    })
    timers.push(window.setTimeout(landed, at + 200))
    const first = read().querySelector('.note[data-n="1"]')
    if (first) {
      timers.push(window.setTimeout(() => first.classList.add('lit'), at + 500))
      timers.push(window.setTimeout(() => first.classList.remove('lit'), at + 1500))
    }
  }

  /** The leader from each number in the answer to its note: along its line, down the gutter, into the note. */
  function draw() {
    if (!wide.matches) {
      wires.innerHTML = ''
      return
    }
    const box = win.getBoundingClientRect()
    const side = panel.getBoundingClientRect()
    let out = ''
    thread()
      .querySelectorAll<HTMLElement>('.ref[data-n]')
      .forEach((mark, i) => {
        const card = read().querySelector(`.note[data-n="${mark.dataset.n}"]`)
        if (!card) return
        const a = mark.getBoundingClientRect()
        const c = card.getBoundingClientRect()
        const x1 = Math.round(a.right + 6 - box.left)
        const y1 = Math.round(a.top + a.height / 2 - box.top)
        const mx = Math.round(side.left - 14 - i * 10 - box.left)
        const x2 = Math.round(c.left - 5 - box.left)
        const y2 = Math.round(c.top + 27 - box.top)
        const t = y2 > y1 ? 1 : -1
        const k = Math.min(8, Math.abs(y2 - y1) / 2)
        out +=
          Math.abs(y2 - y1) < 2
            ? `<path d="M${x1},${y1} H${x2}"/>`
            : `<path d="M${x1},${y1} H${mx - k} Q${mx},${y1} ${mx},${y1 + t * k} V${y2 - t * k} Q${mx},${y2} ${mx + k},${y2} H${x2}"/>`
      })
    wires.innerHTML = out
  }
  const redraw = () => {
    if (win.classList.contains('wired')) draw()
  }
  addEventListener('resize', redraw)
  void document.fonts.ready.then(redraw)
  // A step still rising when the leaders are drawn, on a busy machine, moves its number: draw
  // them again once it has settled.
  let settle = 0
  win.addEventListener('transitionend', (e) => {
    if (e.propertyName !== 'transform') return
    cancelAnimationFrame(settle)
    settle = requestAnimationFrame(redraw)
  })

  // The opening, once: the first question types itself into the box and sends itself. The answer
  // is laid out hidden first, so nothing below it moves when it appears.
  let typing = 0
  let cancelled = false
  function stopTyping() {
    cancelled = true
    if (typing) {
      clearInterval(typing)
      typing = 0
      input.value = ''
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    stopTyping()
    const text = input.value.trim()
    if (!text) return input.focus()
    input.value = ''
    show(matchOf(text), text, 'play')
  })
  for (const c of picks)
    c.addEventListener('click', () => {
      stopTyping()
      input.value = ''
      show(c.dataset.a!, null, 'play')
    })
  // A number in the answer lights its note while it is pointed at or focused.
  const light = (e: Event) => {
    const mark = e.target instanceof Element ? e.target.closest<HTMLElement>('.ref[data-n]') : null
    const on = mark && thread().contains(mark) ? mark.dataset.n : undefined
    for (const note of read().querySelectorAll<HTMLElement>('.note'))
      note.classList.toggle('lit', !!on && note.dataset.n === on)
  }
  win.addEventListener('pointerover', light)
  win.addEventListener('focusin', light)

  if (!moving) {
    show('norway', null, 'now')
    return
  }
  show('norway', null, 'hold')
  const text = thread().querySelector<HTMLElement>('.q')!.dataset.question!
  input.addEventListener('focus', () => {
    if (cancelled) return
    stopTyping()
    reveal(true)
  })
  void document.fonts.ready.then(() =>
    timers.push(
      window.setTimeout(() => {
        if (cancelled) return
        let i = 0
        typing = window.setInterval(() => {
          input.value = text.slice(0, ++i)
          if (i < text.length) return
          clearInterval(typing)
          typing = 0
          cancelled = true
          timers.push(
            window.setTimeout(() => {
              input.value = ''
              reveal(false)
            }, 160),
          )
        }, 22)
      }, 800),
    ),
  )
}
