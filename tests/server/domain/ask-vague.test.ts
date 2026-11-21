import { describe, expect, it } from 'vitest'
import { vagueMetricWord } from '../../../src/domain/ask-held.ts'
import { servedWords, type WrittenTerm } from '../../../src/domain/served-terms.ts'
import { WORLD_TODAY, worldTerms } from './case-world.ts'

/*
  A word that names no one metric, wherever it sits in the question (A5 of the release judgement,
  FR-719.2): alone, Ask's loop asks back with the metrics it may mean before any model reads; in a
  sentence, the model is told them. On the plan
  world, Sales is written for Net revenue and is a word of Gross sales; Revenue is a group of three.
*/

const around = { domains: ['Sales', 'Marketing'], people: ['Jon Abara', 'Sofia Brandt'] }
const vague = (question: string, titles: string[] = [], terms = worldTerms) =>
  vagueMetricWord(question, terms, WORLD_TODAY, { ...around, titles })?.metrics.map(
    (m) => m.name,
  ) ?? null

describe('a word that names no one metric', () => {
  it('is asked about in a sentence as it is alone: another name some metrics share, or a group', () => {
    expect(vague('What about sales in the UK?')).toEqual(['Net revenue', 'Gross sales'])
    expect(vague('sales')).toEqual(['Net revenue', 'Gross sales'])
    expect(vague('Tell me about revenue.')).toEqual(['Net revenue', 'Gross sales', 'Units sold'])
    expect(vague('revenue')).toEqual(['Net revenue', 'Gross sales', 'Units sold'])
    expect(vagueMetricWord('Tell me about revenue.', worldTerms, WORLD_TODAY)?.word).toBe('revenue')
  })

  it('says whether the question is the word alone, which code asks about, and names a group', () => {
    const found = (question: string) => vagueMetricWord(question, worldTerms, WORLD_TODAY, around)
    expect(found('revenue')).toMatchObject({ alone: true, group: 'Revenue' })
    expect(found(' Revenue? ')).toMatchObject({ alone: true })
    expect(found('sales')).toMatchObject({ alone: true, group: null })
    // In a sentence the model reads the metrics it may mean and decides.
    expect(found('Which metrics are in the Revenue group, and how do they differ?')).toMatchObject({
      alone: false,
      group: 'Revenue',
    })
    expect(found('What about sales in the UK?')).toMatchObject({ alone: false })
  })

  it('is no question back when the words name one metric, by its own name or a word only it has', () => {
    expect(vague('What is written about gross sales in the UK?')).toBeNull()
    expect(vague('how did net revenue change last month?')).toBeNull()
    expect(vague('turnover in Spain')).toBeNull()
    expect(vague('What should I know about margin in Spain?')).toBeNull()
    // Two names, one of them a metric's own: the words say which.
    expect(vague('revenue and orders in Spain')).toBeNull()
  })

  it('belongs to a phrase a title holds with the word before it, never to a metric', () => {
    const titles = ['Online sales to Norway stopped on 4 August 2026']
    expect(vague('what stopped online sales to norway?', titles)).toBeNull()
    // A title that holds the word with what follows it, as most titles do, changes nothing.
    expect(vague('What about sales in the UK?', ['Gross sales in the UK in July'])).toEqual([
      'Net revenue',
      'Gross sales',
    ])
  })

  it('is the domain when written as the domain, and the model reads a question about someone', () => {
    // Marketing is a group of metrics and a domain: "in Marketing" is the domain.
    expect(vague('what have we not documented yet in Marketing?')).toBeNull()
    expect(vague('is there anything new for sales in Norway?')).toEqual([
      'Net revenue',
      'Gross sales',
    ])
    // Before a word for what Footnote keeps about a domain, it is the domain.
    expect(vague('what is in the sales inbox?')).toBeNull()
    // A question about people is the model's to decline, never a question about a metric.
    expect(vague('is jon or sofia quicker at clearing the sales inbox?')).toBeNull()
    expect(vague('what did Sofia say about sales?')).toBeNull()
  })

  it('is a word written for two metrics, read as both', () => {
    const sales: WrittenTerm = {
      id: '0190f3a2-0000-7000-8000-000000000001',
      name: 'Sales',
      meaning: null,
      sameAs: 'metric:net_revenue',
      areaId: 'sales',
      writtenOn: '2026-10-20',
      writtenAs: 'owner',
      conflict: true,
      alsoMeans: ['metric:gross_sales'],
    }
    const terms = servedWords(worldTerms, [sales], { all: false, areas: [] }).vocabulary
    expect(vague('What about sales in the UK?', [], terms)).toEqual(
      expect.arrayContaining(['Net revenue', 'Gross sales']),
    )
  })
})
