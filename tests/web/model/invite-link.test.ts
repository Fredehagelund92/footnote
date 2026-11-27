import { describe, expect, it } from 'vitest'
import { inviteLinkWords } from '@/model/invite-link'

// What the toast says of an invite's link once it is made: to send it, that it lets nobody in yet
// where people pick who they are from a list, or that a link to this computer opens nowhere else.

describe("what an invite's link does", () => {
  const link = (host: string) => ({ link: `${host}/#/signin?invite=token` })
  const hosted = link('https://context.example')
  const here = link('http://localhost:8080')

  it('says to send it, where people sign in with their company account', () => {
    expect(inviteLinkWords([hosted], false)).toBe(
      'Send them the link to sign in. It works for 7 days.',
    )
    expect(inviteLinkWords([hosted, hosted], false)).toBe(
      'Send each their link to sign in. It works for 7 days.',
    )
  })

  it('says it lets nobody in yet, where people pick who they are from a list', () => {
    // Nobody invited is on the list, wherever the app is open.
    for (const at of [hosted, here])
      expect(inviteLinkWords([at], true)).toBe(
        'The link lets them in once company sign-in is set up. It works for 7 days.',
      )
    expect(inviteLinkWords([here, here], true)).toBe(
      'Each link lets its person in once company sign-in is set up. They work for 7 days.',
    )
  })

  it('says a link to this computer itself opens nowhere else', () => {
    expect(inviteLinkWords([here], false)).toBe(
      'The link opens only on this computer. It works for 7 days.',
    )
    expect(inviteLinkWords([link('http://127.0.0.1:5173'), hosted], false)).toBe(
      'The links open only on this computer. They work for 7 days.',
    )
  })
})
