import * as React from 'react'
import type { FamilyMeaningChoice } from '@domain/family-meaning'
import type { MeaningParts } from '@/components/footnote/family-meaning'
import type { Family } from '@/lib/definitions'

// An owner's choice of what a family means (M1): worked out from its variants (their common words,
// else the base variant's), one variant's own words, or words written for the family, kept with
// its history. One dialog, three answers; the variant is found by typing, as a family can have
// hundreds.

const n = (x: number) => x.toLocaleString('en-GB')

/** What the rule gives now, in a few words, for the first answer. */
function automatic(family: Family): string {
  const meaning = family.meaning!
  if (meaning.common)
    return `The common words of ${n(meaning.common.agree)} of ${n(family.variants.length)} variants.`
  if (baseWords(family))
    return `The words of ${meaning.base}, the variant the others are converted from.`
  return 'Nothing yet: its variants say different things.'
}

export default function FamilyMeaningDialog({
  name,
  family,
  parts,
  onClose,
}: {
  name: string
  family: Family
  /** What it uses of the app (family-meaning.tsx). */
  parts: MeaningParts
  onClose: () => void
}) {
  const {
    toast,
    useWrite,
    useReported,
    FAMILY_WORDS_MAX,
    MeaningWords,
    Button,
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    RadioGroup,
    Textarea,
  } = parts
  const meaning = family.meaning!
  const chosen = meaning.chosen
  const [choice, setChoice] = React.useState<FamilyMeaningChoice>(chosen?.choice ?? 'auto')
  const described = family.variants.filter((v) => v.description)
  // The variant whose words it takes now, if one does; else none until the owner picks one.
  const [member, setMember] = React.useState(chosen?.member ?? meaning.member ?? '')
  const [words, setWords] = React.useState(chosen?.words ?? meaning.words ?? '')
  const [problem, setProblem] = React.useState<string | null>(null)
  const write = useWrite()
  const saving = useReported<void>({
    wasnt: `What ${name} means wasn't changed.`,
    done: () => {
      toast(`Changed what ${name} means`)
      onClose()
    },
  })
  const sending = saving.state === 'sending'
  const picked = described.find((v) => v.name === member)

  const save = (event: React.FormEvent) => {
    event.preventDefault()
    const typed = words.trim()
    const found =
      choice === 'written' && !typed
        ? 'Write what the family means.'
        : choice === 'written' && [...typed].length > FAMILY_WORDS_MAX
          ? `Keep it to ${n(FAMILY_WORDS_MAX)} characters.`
          : choice === 'member' && !picked
            ? 'Choose the variant whose words it takes.'
            : null
    setProblem(found)
    if (found) return
    saving.act(() =>
      write('setFamilyMeaning', {
        name,
        choice,
        ...(choice === 'member' ? { member } : {}),
        ...(choice === 'written' ? { words: typed } : {}),
        revision: meaning.revision,
      }),
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !sending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} noValidate className="contents">
          <DialogHeader>
            <DialogTitle>What {name} means</DialogTitle>
            <DialogDescription>
              Definitions shows it for the family, and agents read it. Each variant keeps its own
              words.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            aria-label={`What ${name} means`}
            value={choice}
            onValueChange={(v) => {
              setChoice(v as FamilyMeaningChoice)
              setProblem(null)
            }}
            className="gap-1"
          >
            <Answer
              parts={parts}
              value="auto"
              title="Worked out from its variants"
              line={automatic(family)}
            />
            <Answer
              parts={parts}
              value="member"
              title="One variant’s words"
              line={
                described.length
                  ? `${n(described.length)} ${described.length === 1 ? 'variant has' : 'variants have'} words of their own.`
                  : 'No variant has words of its own.'
              }
              disabled={!described.length}
            />
            <Answer
              parts={parts}
              value="written"
              title="Words written for the family"
              line="Kept here with their history."
            />
          </RadioGroup>
          {choice === 'member' && (
            <div className="flex flex-col gap-2">
              <Command className="rounded-md border" label="Variants">
                <CommandInput
                  placeholder="Find a variant"
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={problem ? 'family-words-problem' : undefined}
                />
                <CommandList className="max-h-48">
                  <CommandEmpty>No variant has these words in its name.</CommandEmpty>
                  {described.map((v) => (
                    <CommandItem
                      key={v.name}
                      value={v.name}
                      data-checked={v.name === member || undefined}
                      onSelect={() => {
                        setMember(v.name)
                        setProblem(null)
                      }}
                    >
                      {v.name}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
              {picked && (
                <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
                  <span className="sr-only">Its words: </span>
                  {picked.description}
                </p>
              )}
            </div>
          )}
          {choice === 'written' && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="family-words" className="text-sm font-medium">
                What it means
              </label>
              <Textarea
                id="family-words"
                value={words}
                rows={4}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? 'family-words-problem' : undefined}
                onChange={(e) => {
                  setWords(e.target.value)
                  setProblem(null)
                }}
              />
            </div>
          )}
          {choice === 'auto' && (meaning.common || baseWords(family)) && (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
              <MeaningWords
                meaning={{ ...meaning, words: meaning.common?.words ?? baseWords(family) ?? null }}
                by={family.by}
              />
            </p>
          )}
          {problem && (
            <p id="family-words-problem" role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          {saving.problem && (
            <p role="alert" className="text-sm text-destructive">
              {saving.problem}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={sending} />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={sending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The base variant's own words, when the family has one. */
const baseWords = (family: Family) =>
  family.variants.find((v) => v.name === family.meaning?.base)?.description

function Answer({
  parts: { cn, RadioGroupItem },
  value,
  title,
  line,
  disabled,
}: {
  parts: MeaningParts
  value: FamilyMeaningChoice
  title: string
  line: string
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        'flex cursor-default items-start gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted has-data-checked:bg-muted',
        disabled && 'opacity-60 hover:bg-transparent',
      )}
    >
      <RadioGroupItem value={value} disabled={disabled} className="mt-0.5" />
      <span className="flex flex-col">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{line}</span>
      </span>
    </label>
  )
}
