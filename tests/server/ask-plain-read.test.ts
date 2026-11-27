import { describe, expect, it } from 'vitest'
import { plainStep } from '../../src/server/modules/answer/loop-mock.ts'

/*
  The plain read (loop-mock.ts): what Ask answers with no model connected, which is what
  `docker compose up` starts with, so it is the first answer most people see, and what a turn of
  the loop that stopped shows. It lists what applies, each item's title and then its whole summary.
  It gave the first sentence only once, and the sentence it cut was the reason the person had asked
  for. A title that ends a sentence itself takes no colon.
*/

const read = (
  items: { id: string; title: string; summary: string }[],
  about: string[] = ['metric:new_mrr'],
) =>
  plainStep({
    question: 'Why did new MRR go up in September?',
    before: undefined,
    canRead: true,
    results: [
      { toolName: 'get_context', value: { read: { about }, items } },
      { toolName: 'find_context', value: { items: [], definitions: [] } },
    ],
  }).text

describe('the plain read', () => {
  it('looks the question up once before it says anything', () => {
    expect(
      plainStep({
        question: 'Why did new MRR go up?',
        before: undefined,
        canRead: true,
        results: [],
      }).calls?.map((call) => call.toolName),
    ).toEqual(['get_context', 'find_context'])
  })

  it("gives an item's whole summary, the reason in its second sentence too, cited once", () => {
    expect(
      read([
        {
          id: 'itm_annualprice',
          title: 'Annual plan price went up 12% on 1 September',
          summary:
            'We raised the price of the annual plan by 12% on 1 September 2026. New MRR rose in September because annual customers renewed at the new price, not because more customers signed up.',
        },
      ]),
    ).toBe(
      'What is written for [@metric:new_mrr].\n\n' +
        'Annual plan price went up 12% on 1 September: We raised the price of the annual plan by 12% on 1 September 2026. New MRR rose in September because annual customers renewed at the new price, not because more customers signed up [itm_annualprice].',
    )
  })

  it('writes a summary on one line, with one stop after its citation', () => {
    expect(
      read([
        {
          id: 'itm_trialcount',
          title: 'Trials are counted at sign-up',
          summary:
            'A trial counts on the day it starts.\nDoes it count twice when it restarts? No!',
        },
      ]),
    ).toBe(
      'What is written for [@metric:new_mrr].\n\n' +
        'Trials are counted at sign-up: A trial counts on the day it starts. Does it count twice when it restarts? No [itm_trialcount].',
    )
  })

  it('says so in one sentence when nothing written applies', () => {
    expect(read([])).toBe('Nothing written covers [@metric:new_mrr].')
  })
})

describe('the plain read of an item', () => {
  it('writes a colon between a title and its summary', () => {
    expect(
      read(
        [
          {
            id: 'itm_1',
            title: 'Online sales to Norway stopped on 4 August 2026',
            summary: 'The carrier stopped parcels at the border. They resumed on 9 August.',
          },
        ],
        [],
      ),
    ).toBe(
      'What is written.\n\nOnline sales to Norway stopped on 4 August 2026: The carrier stopped parcels at the border. They resumed on 9 August [itm_1].',
    )
  })

  it('writes no colon after a title that asks a question', () => {
    // It once read "...in February 2026?: What happened...".
    expect(
      read(
        [
          {
            id: 'itm_2',
            title: 'What happened to online sales in Norway in February 2026?',
            summary: 'A storm closed the warehouse for three days. Orders were sent late.',
          },
        ],
        [],
      ),
    ).toBe(
      'What is written.\n\nWhat happened to online sales in Norway in February 2026? A storm closed the warehouse for three days. Orders were sent late [itm_2].',
    )
  })
})
