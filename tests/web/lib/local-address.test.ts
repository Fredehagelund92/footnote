import { describe, expect, it } from 'vitest'
import { localHost, opensOnlyHere } from '@/lib/local-address'
import { askSomeoneCopied } from '@/model/inbox'

// A host that is the computer itself: a link to it opens nowhere else, and a server asked to read
// it looks at itself.

describe('a host that is the computer itself', () => {
  it('is localhost, a name under it, or a loopback address', () => {
    expect(localHost('localhost')).toBe('localhost')
    expect(localHost('Files.LOCALHOST')).toBe('localhost')
    for (const host of ['127.0.0.1', '127.8.0.4', '[::1]', '0.0.0.0'])
      expect(localHost(host), host).toBe('address')
  })

  it('is no other host, even one that only starts the same way', () => {
    for (const host of ['context.example', 'localhost.example', '10.0.0.7', '128.0.0.1', ''])
      expect(localHost(host), host).toBeNull()
  })
})

describe('a link that opens only on this computer', () => {
  it('is one to the computer itself, whatever its port and path', () => {
    expect(opensOnlyHere('http://localhost:8080/#/signin?invite=token')).toBe(true)
    expect(opensOnlyHere('http://127.0.0.1:5173')).toBe(true)
    expect(opensOnlyHere('https://context.example/question/q1')).toBe(false)
    expect(opensOnlyHere('not an address')).toBe(false)
  })

  it('is said when Ask someone who knows copies one, in place of where to paste it', () => {
    expect(askSomeoneCopied('http://localhost:8080')).toBe(
      'It opens only on this computer: the app runs here, at an address nobody else can reach.',
    )
    expect(askSomeoneCopied('https://context.example')).toBe('Paste it to the person who knows.')
  })
})
