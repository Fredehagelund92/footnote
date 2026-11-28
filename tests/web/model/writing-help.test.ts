import { describe, expect, it } from 'vitest'
import {
  askedTurn,
  doneTurn,
  earlierTurns,
  editorFields,
  failedLine,
  failedTurn,
  frontDoor,
  heardTurn,
  keptLine,
  landedFields,
  progressLine,
  readLine,
  refusedLine,
  stoppedByPersonLine,
  stoppedLine,
  stoppedTurn,
  suggestedLine,
  suggestedTurn,
  workingLine,
  type HelpReply,
} from '@/model/writing-help'

// Writing help's chat (Route 3): a turn as it runs and ends, and the words the dock says of it.

const reply = (extra: Partial<HelpReply> = {}): HelpReply => ({
  reply: 'I wrote the title.',
  changed: ['title'],
  kept: [],
  refused: [],
  question: null,
  links: { read: 0, problem: null },
  stopped: null,
  limit: null,
  ...extra,
})

describe('the fields writing help writes, as the editor names them', () => {
  it('reads the summary and the text as the one Text field, each field once', () => {
    expect(editorFields(['title', 'summary', 'text', 'scope', 'window'])).toEqual([
      'title',
      'text',
      'where',
      'when',
    ])
    expect(editorFields(['evidence', 'not_to_conclude', 'kind'])).toEqual([
      'source',
      'dontConclude',
      'kind',
    ])
  })
})

describe('a turn', () => {
  it('hears what it is doing, the fields as they land and the reply’s words', () => {
    let turn = askedTurn('t1', 'Ops told us about Norway.')
    expect(progressLine(turn.progress)).toBe('Starting')
    turn = heardTurn(turn, { type: 'progress', progress: { doing: 'reading', links: 1 } })
    expect(progressLine(turn.progress)).toBe('Reading your message and 1 link')
    turn = heardTurn(turn, { type: 'progress', progress: { doing: 'writing', field: 'where' } })
    expect(progressLine(turn.progress)).toBe('Writing Applies to')
    turn = heardTurn(turn, { type: 'written', changed: ['when'] })
    turn = heardTurn(turn, { type: 'written', changed: ['title', 'when'] })
    // In the form's order, each once.
    expect(turn.changed).toEqual(['title', 'when'])
    turn = heardTurn(turn, { type: 'words', text: 'I wrote' })
    expect(turn.words).toBe('I wrote')
    const done = doneTurn(turn, reply({ changed: ['title', 'when', 'text'] }))
    expect(done).toMatchObject({
      state: 'done',
      words: '',
      progress: null,
      changed: ['title', 'text', 'when'],
    })
    // A turn that ended hears nothing more.
    expect(heardTurn(done, { type: 'words', text: 'late' })).toBe(done)
  })

  it('says what it is doing in plain lines', () => {
    expect(progressLine({ doing: 'reading', links: 0 })).toBe('Reading your message')
    expect(progressLine({ doing: 'reading', links: 2 })).toBe('Reading your message and 2 links')
    expect(progressLine({ doing: 'looking' })).toBe('Looking at what is published')
    expect(progressLine({ doing: 'writing' })).toBe('Writing the draft')
  })

  it('sends the answered turns again, the latest six, each cut short', () => {
    const turns = Array.from({ length: 8 }, (_, i) =>
      doneTurn(askedTurn(`t${i}`, `said ${i}`), reply({ reply: `reply ${i}` })),
    )
    const stopped = stoppedTurn(askedTurn('s', 'stopped one'))
    const failed = failedTurn(askedTurn('f', 'failed one'), 'No.')
    const sent = earlierTurns([...turns, stopped, failed])
    expect(sent).toHaveLength(6)
    expect(sent[0]).toEqual({ said: 'said 2', reply: 'reply 2' })
    expect(sent.at(-1)).toEqual({ said: 'said 7', reply: 'reply 7' })
    const long = doneTurn(askedTurn('l', 'a'.repeat(5_000)), reply({ reply: 'b'.repeat(5_000) }))
    expect(earlierTurns([long])[0]).toEqual({ said: 'a'.repeat(2_000), reply: 'b'.repeat(2_000) })
  })
})

describe('the first box of Write context', () => {
  it('hands the words to writing help where it is there to ask, and says where they go', () => {
    for (const admin of [true, false])
      expect(frontDoor({ help: true, model: true, admin })).toEqual({
        by: 'help',
        how: 'Paste a message, a link, or just say what happened. Writing help writes the draft, and you check each field.',
        button: 'Write the draft',
        note: 'What you write here goes to the AI model set for Ask. Only you see the draft until you send or publish it.',
        more: [],
      })
  })

  const askAnAdmin = {
    text: 'Ask an admin to turn on writing help in Settings, and you can talk the draft through.',
  }
  const turnOn = {
    text: 'With writing help on, people can talk a draft through.',
    link: { to: 'switch', label: 'Turn it on in Settings' },
  }
  const connect = {
    text: 'Writing help needs an AI model, and none is connected to this workspace.',
    link: { to: 'model-guide', label: 'How to connect a model' },
  }

  it('fills the fields by rule with writing help off, and says who can turn it on', () => {
    expect(frontDoor({ help: false, model: true, admin: false })).toMatchObject({
      by: 'rule',
      how: 'Paste a message, a link, or just say what happened. The fields fill in from it, and you check each one.',
      button: 'Fill it in',
      note: 'Filled in by rule, with no AI model.',
      more: [askAnAdmin],
    })
    expect(frontDoor({ help: false, model: true, admin: true }).more).toEqual([turnOn])
  })

  it('with no model, tells a member who can turn it on, and gives an admin both ways forward', () => {
    expect(frontDoor({ help: false, model: false, admin: false })).toMatchObject({
      by: 'rule',
      button: 'Fill it in',
      note: 'Filled in by rule, with no AI model.',
      more: [askAnAdmin],
    })
    expect(frontDoor({ help: false, model: false, admin: true }).more).toEqual([connect, turnOn])
  })
})

describe('a field the person was writing in', () => {
  it('waits as a suggestion with the turn that wrote it, while it runs or after it ended', () => {
    let turn = heardTurn(askedTurn('t1', 'Make the title say webshop.'), {
      type: 'written',
      changed: ['title', 'when'],
    })
    turn = suggestedTurn(turn, ['title'])
    expect(turn.suggested).toEqual(['title'])
    // The draft the person sees still says their title: only When changed in it.
    expect(landedFields(turn)).toEqual(['when'])
    const done = suggestedTurn(doneTurn(turn, reply({ changed: ['title', 'text', 'when'] })), [
      'text',
      'title',
    ])
    expect(done.suggested).toEqual(['title', 'text'])
    expect(landedFields(done)).toEqual(['when'])
  })

  it('is said under the reply in writing help’s own words', () => {
    expect(suggestedLine([])).toBe('')
    expect(suggestedLine(['title'])).toBe(
      'You were typing in Title, so I left your words and put mine under it. Use it, or keep yours.',
    )
    expect(suggestedLine(['title', 'text'])).toBe(
      'You were typing in Title and Text, so I left your words and put mine under them. Use them, or keep yours.',
    )
  })

  it('is not counted as changed when a turn ends early', () => {
    expect(stoppedLine(reply({ stopped: 'time', changed: ['title', 'kind'] }), ['kind'])).toBe(
      'Writing help ran out of time before it finished. What it changed is in your draft: Kind. Try again.',
    )
  })
})

describe('the strip in the draft while a turn runs', () => {
  it('says what writing help is doing, under its name', () => {
    expect(workingLine({ doing: 'reading', links: 1 })).toBe(
      'Writing help is reading your message and 1 link.',
    )
    expect(workingLine({ doing: 'reading', links: 0 })).toBe(
      'Writing help is reading your message.',
    )
    expect(workingLine({ doing: 'looking' })).toBe('Writing help is looking at what is published.')
    for (const progress of [null, { doing: 'writing' as const, field: 'title' as const }])
      expect(workingLine(progress)).toBe(
        'Writing help is writing the draft. Your hands are free: it skips a field you type in.',
      )
  })
})

describe('what the dock says under a reply', () => {
  it('says what it read of a link, or why it did not, and nothing with no link', () => {
    expect(readLine(reply())).toBe('')
    expect(readLine(reply({ links: { read: 1, problem: null } }))).toBe(
      'Read your message and 1 link',
    )
    expect(
      readLine(reply({ links: { read: 0, problem: 'Reading links is off in this workspace.' } })),
    ).toBe('Reading links is off in this workspace.')
  })

  it('names the fields that kept the person’s words, and a refused field with why', () => {
    expect(keptLine([])).toBe('')
    expect(keptLine(['title', 'when'])).toBe('Kept as you wrote it: Title and When.')
    expect(refusedLine({ field: 'text', why: 'Its words read like orders to an AI agent.' })).toBe(
      'Text is as it was. Its words read like orders to an AI agent.',
    )
  })

  it('says why a turn ended early: what went wrong, what is safe and what to do', () => {
    expect(stoppedLine(reply())).toBe('')
    expect(stoppedLine(reply({ stopped: 'model', changed: [] }))).toBe(
      'Writing help did not answer just now. Nothing changed. Try again.',
    )
    expect(stoppedLine(reply({ stopped: 'time', changed: ['title', 'kind'] }))).toBe(
      'Writing help ran out of time before it finished. What it changed is in your draft: Title and Kind. Try again.',
    )
    expect(stoppedLine(reply({ stopped: 'steps', changed: [] }))).toBe(
      'Writing help stopped at its limit of steps before it finished. Nothing changed. Try again.',
    )
    expect(
      stoppedLine(
        reply({
          stopped: 'spending',
          changed: [],
          limit: 'Your AI cost today reached the daily limit of $2.00; it resets within 24 hours.',
        }),
      ),
    ).toBe(
      'Your AI cost today reached the daily limit of $2.00; it resets within 24 hours. Nothing changed.',
    )
    expect(stoppedLine(reply({ stopped: 'key', changed: [] }))).toBe(
      'The AI provider refused the key. Nothing changed. Ask an admin to give it a key that works.',
    )
    expect(stoppedLine(reply({ stopped: 'credit', changed: [] }))).toBe(
      'The AI provider says its account is out of credit. Nothing changed. Ask an admin to add credit.',
    )
  })

  it('says a turn that could not be asked, and one the person stopped', () => {
    expect(failedLine('An admin has turned off writing help.', [])).toBe(
      "Couldn't ask writing help. An admin has turned off writing help.",
    )
    expect(failedLine(null, [])).toBe("Couldn't reach writing help. Nothing changed. Try again.")
    // A stream that dropped after fields landed says they are in the draft, not that nothing changed.
    expect(failedLine(null, ['title', 'kind'])).toBe(
      "Couldn't reach writing help. What it changed is in your draft: Title and Kind. Try again.",
    )
    expect(stoppedByPersonLine([])).toBe('Stopped. Nothing changed.')
    expect(stoppedByPersonLine(['title'])).toBe('Stopped. What it changed is in your draft: Title.')
  })
})
