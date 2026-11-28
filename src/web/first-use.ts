// What only a first visit reads: the first screen, the Inbox's checklist and its Next card. One
// module, so that the lazy imports make one chunk, and the first load carries none of them.
export { FirstPerson } from '@/pages/first-person'
export { Setup } from '@/components/footnote/setup-card'
export { NextCard } from '@/components/footnote/next-card'
