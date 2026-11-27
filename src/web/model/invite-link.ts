import { opensOnlyHere } from '@/lib/local-address'

// What the People page says of an invite's link. A module of its own, so its sentences load with
// that page and not with the app's first load, which the people model is part of.

/**
 * What an invite's link does, as the toast says once it is made. Where people pick who they are
 * from a list (`picker`), nobody invited is on it, so the link lets them in only once company
 * sign-in is set up; and a link to this computer itself opens nowhere else.
 */
export function inviteLinkWords(links: readonly { link: string }[], picker: boolean): string {
  const one = links.length === 1
  if (picker)
    return one
      ? 'The link lets them in once company sign-in is set up. It works for 7 days.'
      : 'Each link lets its person in once company sign-in is set up. They work for 7 days.'
  if (links.some((l) => opensOnlyHere(l.link)))
    return one
      ? 'The link opens only on this computer. It works for 7 days.'
      : 'The links open only on this computer. They work for 7 days.'
  return one
    ? 'Send them the link to sign in. It works for 7 days.'
    : 'Send each their link to sign in. It works for 7 days.'
}
