import { ring } from '../shared/ground.ts'
import * as meaning from './meaning.ts'

/*
  The landing page below its first screen (landing/pages/index.astro): the definitions window, the
  tour of real screens, the week picked along the Orders line, what arrives as it scrolls into view,
  and the light that follows the pointer over a window. With reduced motion nothing arrives or
  walks: everything is there, the tour waits for a press, and the line waits for a drag or a key.
*/

export function page() {
  const moving = document.documentElement.classList.contains('anim')
  definitions()
  scrub(moving)
  const tour = walk(moving)
  arrive(moving, tour)
  if (moving) glow()
}

/** Pressing a metric, in the list or in a tree, opens it. */
function definitions() {
  const root = document.querySelector<HTMLElement>('#def')
  if (!root) return
  const list = [...root.querySelectorAll<HTMLButtonElement>('.side button[data-m]')]
  const parts = [...root.querySelectorAll<HTMLElement>('[data-metric]')]
  root.addEventListener('click', (e) => {
    const button =
      e.target instanceof Element ? e.target.closest<HTMLElement>('button[data-m]') : null
    if (!button) return
    const key = button.dataset.m!
    for (const b of list) b.setAttribute('aria-pressed', String(b.dataset.m === key))
    for (const part of parts) part.hidden = part.dataset.metric !== key
    if (!list.includes(button as HTMLButtonElement))
      root.querySelector('.def-main:not([hidden]) h3')?.scrollIntoView({ block: 'nearest' })
  })
}

/**
 * Meaning, not numbers: the question asks about the week picked on the Orders line, by a drag, a
 * press or the arrow keys, and what Footnote matches and what the agent says follow it. Once in
 * view, with motion, the cursor walks from late June over the stop to mid August, then waits; a
 * touch or a key ends the walk. Without motion it opens on mid August as the page was built.
 */
function scrub(moving: boolean) {
  const root = document.querySelector<HTMLElement>('#sb')
  if (!root) return
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const chart = $('.sb-chart')
  const range = $<HTMLInputElement>('.sb-range')
  const cursor = $('.sb-cur')
  const point = $('.sb-pt')
  const flag = $('.sb-flag')
  const says = $('.sb-says')
  const live = $('#sb-live')
  let shown = meaning.opening

  /** Week i on the chart and in words; `told` also says it to a screen reader. */
  function show(i: number, told = false) {
    const at = meaning.at(i)
    cursor.style.left = `${at.x * 100}%`
    point.style.top = `${at.y * 100}%`
    const edge = at.x * 100
    flag.style.transform = `translateX(${edge < 8 ? -10 : edge > 92 ? -90 : -50}%)`
    if (i === shown) return
    const was = meaning.week(shown)
    const week = meaning.week(i)
    shown = i
    flag.textContent = week.day.replace(/ \d{4}$/, '')
    root!.classList.toggle('in-note', week.applies)
    $('.sb-date').textContent = week.day
    range.setAttribute('aria-valuetext', `Week of ${week.day}`)
    $('.sb-move').textContent = week.move
    $('.sb-dates').classList.toggle('ok', week.applies)
    $('.sb-dtext').textContent = week.dates
    $('.sb-hit').hidden = !week.applies
    $('.sb-miss').hidden = week.applies
    says.textContent = week.says
    if (week.applies) {
      const ref = document.createElement('span')
      ref.className = 'ref'
      ref.setAttribute('role', 'img')
      ref.setAttribute('aria-label', 'Footnote 1')
      ref.textContent = '1'
      says.append(ref)
    }
    if (told)
      live.textContent = `${week.applies ? 'Checked' : 'Not found'}. Your agent says: ${week.says}`
    if (moving && was.applies !== week.applies) {
      says.classList.remove('swap')
      void says.offsetWidth
      says.classList.add('swap')
      if (week.applies) light()
    }
  }

  /** The ring where the line falls, of the chart's own dots. */
  function light() {
    const at = meaning.at(meaning.stop)
    for (const dot of ring(
      at.x * chart.clientWidth,
      at.y * chart.clientHeight,
      chart.clientWidth,
      chart.clientHeight,
    )) {
      const lit = document.createElement('i')
      lit.className = 'sb-lit'
      lit.setAttribute('aria-hidden', 'true')
      lit.style.left = `${dot.x}px`
      lit.style.top = `${dot.y}px`
      lit.style.setProperty('--t', `${dot.delay}ms`)
      lit.style.setProperty('--a', String(dot.strength))
      chart.append(lit)
      lit.addEventListener('animationend', () => lit.remove())
    }
  }

  let glide = 0
  let used = false
  function end() {
    cancelAnimationFrame(glide)
    glide = 0
    root!.classList.remove('glide')
  }
  range.addEventListener('input', () => {
    end()
    used = true
    root.classList.add('used')
    show(Number(range.value), true)
  })
  const touched = () => {
    used = true
    end()
  }
  range.addEventListener('pointerdown', touched)
  range.addEventListener('keydown', touched)
  root.classList.toggle('in-note', meaning.week(shown).applies)
  if (!moving) return

  range.value = String(meaning.walkFrom)
  show(meaning.walkFrom)
  const seen = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      seen.disconnect()
      window.setTimeout(() => {
        if (used) return
        const from = meaning.walkFrom
        const to = meaning.opening
        const t0 = performance.now()
        root.classList.add('glide')
        const tick = (now: number) => {
          const k = Math.min(1, (now - t0) / 2200)
          const e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2
          const i = Math.round(from + (to - from) * e)
          range.value = String(i)
          show(i)
          if (k < 1) glide = requestAnimationFrame(tick)
          else end()
        }
        glide = requestAnimationFrame(tick)
      }, 500)
    },
    { threshold: 0.35 },
  )
  seen.observe(root)
}

/**
 * The tour: one real screen of the app per tab, the arrow keys moving between them. While it is
 * on screen and nobody has touched it, it walks by itself; hover or focus holds it, a press ends it.
 */
function walk(moving: boolean) {
  const tour = document.querySelector<HTMLElement>('#tour')
  if (!tour) return undefined
  const tabs = [...tour.querySelectorAll<HTMLButtonElement>('[role=tab]')]
  const shot = tour.querySelector<HTMLElement>('#shot')!
  const [light, dark] = [...shot.querySelectorAll('img')]
  let auto = moving
  let hold = false
  let seen = false
  let turn = 0
  if (moving)
    for (const tab of tabs)
      for (const src of [tab.dataset.light!, tab.dataset.dark!]) new Image().src = src

  function pick(tab: HTMLButtonElement, focus = false) {
    for (const t of tabs) {
      const on = t === tab
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1
    }
    const set = () => {
      light!.src = tab.dataset.light!
      dark!.src = tab.dataset.dark!
      light!.alt = dark!.alt = tab.dataset.alt!
      shot.classList.remove('swap')
    }
    if (moving) {
      shot.classList.add('swap')
      window.setTimeout(set, 200)
    } else set()
    if (focus) tab.focus()
  }
  function arm() {
    clearTimeout(turn)
    tour!.classList.remove('run')
    if (!auto || hold || !seen) return
    void tour!.offsetWidth
    tour!.classList.add('run')
    turn = window.setTimeout(() => {
      const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true')
      pick(tabs[(i + 1) % tabs.length]!)
      arm()
    }, 6000)
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      auto = false
      arm()
      pick(tab)
    })
    tab.addEventListener('keydown', (e) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : step && i + step
      if (to === undefined) return
      e.preventDefault()
      auto = false
      arm()
      pick(tabs[(to + tabs.length) % tabs.length]!, true)
    })
  })
  const holding = (on: boolean) => () => {
    hold = on
    arm()
  }
  tour.addEventListener('pointerenter', holding(true))
  tour.addEventListener('pointerleave', holding(false))
  tour.addEventListener('focusin', holding(true))
  tour.addEventListener('focusout', holding(false))
  return {
    root: tour,
    seen(on: boolean) {
      seen = on
      arm()
    },
  }
}

/** What scrolls into view arrives once. The statement's words come up to full strength in reading order. */
function arrive(moving: boolean, tour: ReturnType<typeof walk>) {
  const statement = document.querySelector<HTMLElement>('#state')
  if (statement && moving) {
    let n = 0
    // A copy of the list, as the loop replaces its nodes.
    for (const node of Array.from(statement.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE && node.nodeName !== 'B') continue
      const words = document.createDocumentFragment()
      for (const w of (node.textContent ?? '').split(/(\s+)/)) {
        if (!w.trim()) {
          words.append(w)
          continue
        }
        const span = document.createElement('span')
        span.className = 'sw'
        span.style.setProperty('--i', String(n++))
        span.textContent = w
        words.append(span)
      }
      if (node.nodeType === Node.TEXT_NODE) node.replaceWith(words)
      else {
        node.textContent = ''
        node.appendChild(words)
      }
    }
  }
  const parts = [...document.querySelectorAll<HTMLElement>('.rv')]
  if (!moving) {
    for (const part of parts) part.classList.add('in')
    return
  }
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        e.target.classList.add('in')
        seen.unobserve(e.target)
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
  )
  for (const part of parts) seen.observe(part)
  if (tour)
    new IntersectionObserver((entries) => tour.seen(entries[0]!.isIntersecting), {
      threshold: 0.4,
    }).observe(tour.root)
}

/** A light that follows the pointer over a window: a soft pool inside, a brighter stretch of its hairline. */
function glow() {
  for (const el of document.querySelectorAll<HTMLElement>('.glow'))
    el.addEventListener('pointermove', (e) => {
      const box = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - box.left}px`)
      el.style.setProperty('--my', `${e.clientY - box.top}px`)
    })
}
