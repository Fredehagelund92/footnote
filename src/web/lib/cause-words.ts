// The words with which a text gives a cause: "rose because annual customers renewed", "low due
// to the outage". The editor says, under Don't conclude, that agents pass such a cause on as the
// writer's words, so a cause nobody has shown is said there.

const CAUSE =
  /\b(because|due to|caused by|as a result of|thanks to|owing to|led to|leads to|resulted in|driven by)\b/i

/** The first words of a cause in a text, as written ("because"), or null when it gives none. */
export function causeIn(text: string): string | null {
  return CAUSE.exec(text)?.[1] ?? null
}
