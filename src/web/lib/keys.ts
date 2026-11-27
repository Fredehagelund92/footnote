// Single-key shortcuts (J, K, N, P, ?, Esc) belong to the page only while nobody is typing: never
// in a field, a rich-text editor (a note, a comment), an open list, a menu or a dialog.

const TYPING =
  "input, textarea, select, [contenteditable=''], [contenteditable=true], [role=textbox], [role=combobox], [role=listbox], [role=dialog], [role=alertdialog], [role=menu]"

export function isTyping(target: EventTarget | null) {
  return target instanceof Element && !!target.closest(TYPING)
}

// A dialog or sheet drawn over the page (its backdrop open) takes every key, from the moment it
// opens: it moves the focus inside a frame later, and a key pressed meanwhile reaches the page from
// the body, where Esc would also put away the Inbox's card.
const COVERED = '[data-slot=dialog-overlay][data-open], [data-slot=sheet-overlay][data-open]'

/** A plain key press for a page shortcut: nothing typed into, no modifier held, no dialog open. */
export const pageKey = (e: KeyboardEvent) =>
  !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector(COVERED)

/** G then a letter goes to a place (lib/go-to.ts). */
export const GO_TO = [
  { key: 'I', place: 'Inbox' },
  { key: 'A', place: 'Ask' },
  { key: 'C', place: 'Context' },
  { key: 'D', place: 'Definitions' },
  { key: 'S', place: 'Settings' },
] as const

export type GoPlace = (typeof GO_TO)[number]['place']
