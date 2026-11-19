import type { Plugin, ResolvedConfig } from 'vite'
import { describe, expect, it } from 'vitest'
import { productTitle, themeBootstrap } from '../../vite.config.ts'

function titleFor(name: string | undefined): string {
  const plugin: Plugin = productTitle()
  const configResolved = plugin.configResolved as (config: ResolvedConfig) => void
  configResolved({ env: { FOOTNOTE_PRODUCT_NAME: name } } as unknown as ResolvedConfig)
  const transform = plugin.transformIndexHtml as (html: string) => string
  return transform('<title>%PRODUCT_NAME%</title>')
}

describe('productTitle', () => {
  it('writes a name with $ patterns and punctuation literally, HTML-escaped', () => {
    expect(titleFor('Acme & Co: Ledger #1 $& "q"')).toBe(
      '<title>Acme &amp; Co: Ledger #1 $&amp; &quot;q&quot;</title>',
    )
  })
})

describe('themeBootstrap', () => {
  it('inlines the theme key of the resolved product name', () => {
    const plugin: Plugin = themeBootstrap()
    const configResolved = plugin.configResolved as (config: ResolvedConfig) => void
    configResolved({ env: { FOOTNOTE_PRODUCT_NAME: 'Acme' } } as unknown as ResolvedConfig)
    const hook = plugin.transformIndexHtml as unknown as {
      handler: () => { children: string }[]
    }
    const script = hook.handler()[0]!.children
    expect(script).toContain('"acme-theme"')
    expect(script).not.toContain('footnote-theme')
  })
})
