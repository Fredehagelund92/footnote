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
  // Reads the market:Norway mentions saved chats hold, from before Ask's @ offered every value.
  'src/web/lib/mentions.ts',
  // Reads the answers a browser kept before their values were named values, as markets.
  'src/web/api/http-ask.ts',
  // Reads a link's ?market= from before about= took values of any dimension, as about=.
  'src/web/lib/search.ts',
]

export default { rules: { 'market-names': marketNames } }
