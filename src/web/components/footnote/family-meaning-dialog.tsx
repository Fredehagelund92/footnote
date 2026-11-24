import * as React from 'react'
import { familyWordings } from '@domain/family-meaning'
import { meaningLine, type FamilyMeaningChoice } from '@domain/family-meaning-line'
import type { MeaningParts } from '@/components/footnote/family-meaning'
import type { Family } from '@/lib/definitions'

// An owner's choice of what a family means (M1): worked out from its variants, or words written
// for the family. One dialog, two answers. The written answer starts from what its variants say,
// each wording once, as a family of hundreds writes a few: Use puts one in the box, each value as
// what it stands for ("in each currency"), so the owner edits words that speak for every variant.

const n = (x: number) => x.toLocaleString('en-GB')
/** The most wordings the written answer offers before Show more. */
const WORDINGS_SHOWN = 3

/** What the rule gives now, in a few words, for the first answer. */
function automatic(family: Family): string {
  const meaning = family.meaning!
  const base = family.variants.find((v) => v.name === meaning.base)
  if (meaning.automatic && base)
    return `The words of ${base.values.join(', ')}, the variant the others are converted from.`
  if (meaning.automatic && meaning.common)
    return `The common words of ${n(meaning.common.agree)} of ${n(family.variants.length)} variants.`
  return 'Nothing yet: no words speak for all its variants.'
}

export default function FamilyMeaningDialog({
  name,
  family,
  parts,
  writing = false,
  finalFocus,
  onClose,
}: {
  name: string
  family: Family
  /** What it uses of the app (family-meaning.tsx). */
  parts: MeaningParts
  /** It opens on words written for the family, when no owner has chosen yet. */
  writing?: boolean
  /** Where focus goes once it closes; its opener's own place when none. */
  finalFocus?: React.RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const {
    toast,
    useWrite,
    useReported,
    FAMILY_WORDS_MAX,
    MeaningWords,
    SourceText,
    Button,
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
  const [choice, setChoice] = React.useState<FamilyMeaningChoice>(
    writing ? 'written' : (chosen?.choice ?? 'auto'),
  )
  const [words, setWords] = React.useState(
    chosen?.words ?? (meaning.automatic ? meaningLine(meaning.automatic, family.by) : ''),
  )
  const [problem, setProblem] = React.useState<string | null>(null)
  const [all, setAll] = React.useState(false)
  const wordings = React.useMemo(
    () =>
      familyWordings({
        by: family.by,
        variants: family.variants.map((v) => ({
          key: v.name,
          values: v.values,
          description: v.description ?? null,
        })),
      }),
    [family],
  )
  const box = React.useRef<HTMLTextAreaElement>(null)
  const list = React.useRef<HTMLUListElement>(null)
  const write = useWrite()
  const saving = useReported<void>({
    wasnt: `What ${name} means wasn't changed.`,
    done: () => {
      toast(`Changed what ${name} means`)
      onClose()
    },
  })
  const sending = saving.state === 'sending'
  const shown = all ? wordings : wordings.slice(0, WORDINGS_SHOWN)
  React.useEffect(() => {
    if (all) list.current?.querySelectorAll('button')[WORDINGS_SHOWN]?.focus()
  }, [all])

  const save = (event: React.FormEvent) => {
    event.preventDefault()
    const typed = words.trim()
    const found =
      choice === 'written' && !typed
        ? 'Write what the family means.'
        : choice === 'written' && [...typed].length > FAMILY_WORDS_MAX
          ? `Keep it to ${n(FAMILY_WORDS_MAX)} characters.`
          : null
    setProblem(found)
    if (found) return
    saving.act(() =>
      write('setFamilyMeaning', {
        name,
        choice,
        ...(choice === 'written' ? { words: typed } : {}),
        revision: meaning.revision,
      }),
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !sending && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        {...(writing ? { initialFocus: box } : {})}
        {...(finalFocus ? { finalFocus } : {})}
      >
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
            >
              {choice === 'auto' && meaning.automatic && (
                <p className="mt-2 rounded-md bg-background px-3 py-2 text-sm leading-6">
                  <MeaningWords meaning={{ ...meaning, words: meaning.automatic }} by={family.by} />
                </p>
              )}
            </Answer>
            <Answer
              parts={parts}
              value="written"
              title="Written for the family"
              line="Shown as written, with who wrote it and when."
            />
          </RadioGroup>
          {choice === 'written' && (
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="family-words" className="text-sm font-medium">
                  What it means
                </label>
                <Textarea
                  ref={box}
                  id="family-words"
                  value={words}
                  rows={3}
                  aria-invalid={problem ? true : undefined}
                  aria-describedby={problem ? 'family-words-problem' : undefined}
                  onChange={(e) => {
                    setWords(e.target.value)
                    setProblem(null)
                  }}
                />
              </div>
              {wordings.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p id="family-wordings" className="text-xs text-muted-foreground">
                    Start from what its variants say
                  </p>
                  <ul
                    ref={list}
                    aria-labelledby="family-wordings"
                    className="flex max-h-72 flex-col divide-y overflow-y-auto rounded-md border"
                  >
                    {shown.map((w) => {
                      const said = w.values.join(', ') || 'One variant'
                      return (
                        <li
                          key={w.values.join('\u0000')}
                          className="flex items-start gap-3 px-3 py-2 text-sm"
                        >
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="text-xs text-muted-foreground">
                              {said}
                              {w.count > 1 && ` and ${n(w.count - 1)} more`}
                            </span>
                            <span className="line-clamp-2 break-words">
                              <SourceText text={w.words} />
                            </span>
                          </span>
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto shrink-0 p-0"
                            aria-label={`Use what ${said} says`}
                            onClick={() => {
                              setWords(w.line)
                              setProblem(null)
                              box.current?.focus()
                            }}
                          >
                            Use
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                  {!all && wordings.length > WORDINGS_SHOWN && (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto self-start p-0 text-xs"
                      onClick={() => setAll(true)}
                    >
                      Show {n(wordings.length - WORDINGS_SHOWN)} more
                    </Button>
                  )}
                </div>
              )}
            </div>
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

function Answer({
  parts: { RadioGroupItem },
  value,
  title,
  line,
  children,
}: {
  parts: MeaningParts
  value: FamilyMeaningChoice
  title: string
  line: string
  children?: React.ReactNode
}) {
  const id = React.useId()
  return (
    <div className="flex items-start gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted has-data-checked:bg-muted">
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col">
        <label htmlFor={id} className="flex cursor-default flex-col">
          <span className="font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">{line}</span>
        </label>
        {children}
      </div>
    </div>
  )
}
