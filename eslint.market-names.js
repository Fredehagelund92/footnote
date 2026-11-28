/*
  Market is a dimension like any other (country, currency, channel, whatever a source defines),
  and stays one: nothing decides or shows anything by the name market. This reports an identifier
  with market in it ("marketing" is a domain of the demo world, not the dimension), and a string
  that is market itself, a dimension's key (`dim:market`, `val:market/norway`) or a mention's
  (`market:Norway`, `market/norway`). Comments and the text of JSX are words, never names. The
  server's own tests pass with the dimension renamed (tests/lint/renamed-dimension.config.ts).
*/

const NAMED_ID = /market(?!ing)/i
const NAMED_TEXT = /^(markets?|Markets?)$|dim:market|val:market\/|^market[/:]/

const marketNames = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      named:
        "Market is a dimension like any other. Read the value's dimension instead of naming market.",
    },
  },
  create(context) {
    const text = (node, value) => {
      if (typeof value === 'string' && NAMED_TEXT.test(value))
        context.report({ node, messageId: 'named' })
    }
    return {
      Identifier(node) {
        if (NAMED_ID.test(node.name)) context.report({ node, messageId: 'named' })
      },
      Literal(node) {
        text(node, node.value)
      },
      TemplateElement(node) {
        text(node, node.value.cooked)
      },
    }
  },
}

/*
  The demo world, which may name its own markets: the web's mock binding and its data.
*/
export const marketDemoWorld = ['src/web/api/mock/**']

/*
  What still names market under src, and why; each goes with its own change. Take a file off when
  it no longer names market; add none.
*/
export const stillNamesMarket = [
  // The static example calls the schema check reads; an install is shown its own terms.
  'src/server/mcp/invalid-input.ts',
  // Reads the market:Norway mentions saved chats hold, from before Ask's @ offered every value.
  'src/web/lib/mentions.ts',
  // Reads the answers a browser kept before their values were named values, as markets.
  'src/web/api/http-ask.ts',
  // One look for every value: the Market-only icon and hue.
  'src/web/components/footnote/scope-chips.tsx',
  'src/web/components/footnote/mention-chip.tsx',
  'src/web/components/footnote/tag-chip.tsx',
  'src/web/lib/tones.ts',
  'src/web/pages/context-time.tsx',
  // A link's ?market= (about= takes values of any dimension); old links keep reading it.
  'src/web/pages/editor.tsx',
  'src/web/lib/search.ts',
  'src/web/lib/editor-start.ts',
  'src/web/pages/inbox.tsx',
  'src/web/components/footnote/answer.tsx',
  'src/web/components/obs/answer-panel.tsx',
]

export default { rules: { 'market-names': marketNames } }
