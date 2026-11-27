import * as React from 'react'
import { useEditor } from '@tiptap/react'
import type { Node } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { PanelRightIcon } from '@/components/icons'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { RichTextEditor } from '@/components/editor'
import { Button, buttonVariants } from '@/components/ui/button'
import { DocumentEditorShell } from '@/components/footnote/document-shell'
import { DocFooter, Paper } from '@/components/footnote/doc'
import { HeaderMore, SaveStatus } from '@/components/footnote/editor-header'
import { Panel } from '@/components/footnote/panel'
import { ResizableAside } from '@/components/resizable-aside'
import { SiteHeader } from '@/components/site-header'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useHelpAside } from '@/lib/help-aside'
import { useWide } from '@/hooks/use-wide'
import { docExtensions } from '@/lib/doc-extensions'
import { href, navigate, useRoute } from '@/lib/router'
import { toApiError } from '@/api/errors'
import { useVocabulary, useWorkspace, useWrite } from '@/api/queries'
import { useAutosave } from '@/lib/autosave'
import { useMe } from '@/lib/workspace'
import { useGlossary } from '@/lib/definitions'
import { definedInAbout, definedWords } from '@/lib/about-words'
import {
  ABOUT_BUSINESS_GUIDE,
  ABOUT_BUSINESS_MAX,
  ABOUT_GUIDE_PARTS,
  aboutBusinessLength,
  aboutGuidePartsIn,
  normalizeAboutBusiness,
} from '@domain/about-business'

// About our business in the same document editor shell as a context item: the formatting row under
// the header, the text on the document sheet, markdown in and out, one footer with the count. It
// saves itself, so a quiet status replaces a Save button. The help panel is closed until asked for.
// The text says what the company does; words and their meanings go in Definitions, so a line
// that defines a word Definitions already has says so under the field. Write a first version for
// me drafts the text from the install, and Start from the guide puts the shape of the text on the
// sheet, a part in brackets for each thing to say. Either is shown to change and saved only when
// kept, the guide only with every part filled in, so nothing reaches Ask or an agent before then.
// Loaded on its own, like the other editors, to keep Tiptap out of the first load.

const LIMIT = ABOUT_BUSINESS_MAX

/** Where the guide's parts still stand on the sheet, in its order: each with its brackets. */
function guidePartsOn(doc: Node): { from: number; to: number }[] {
  const found: { from: number; to: number }[] = []
  doc.descendants((node, at) => {
    for (const part of ABOUT_GUIDE_PARTS) {
      const from = node.text?.indexOf(part) ?? -1
      if (from >= 0) found.push({ from: at + from, to: at + from + part.length })
    }
  })
  return found.sort((a, b) => a.from - b.from)
}

/** One part of the guide selected whole, so the next words typed take its place. */
function selectGuidePart(view: EditorView, part: { from: number; to: number }) {
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, part.from, part.to)),
  )
  view.focus()
}

export function AboutPage({
  title,
  helpText,
}: {
  title: React.ReactNode
  helpText: React.ReactNode
}) {
  const me = useMe()
  const { about, domains } = useWorkspace()
  // A first version is written from the domains and the metrics: offered once there are some.
  const { metrics } = useVocabulary()
  const draftable = metrics.length > 0 || domains.some((d) => !d.sandbox)
  const glossary = useGlossary()
  const write = useWrite()
  const { query } = useRoute()
  const setup = query.get('setup')
  // Null until the first keystroke; until then the count and the words are what the editor writes back.
  const [typed, setTyped] = React.useState<string | null>(null)
  // A first version or the guide on the sheet that is not kept yet: what is typed into it is not
  // saved either.
  const [draft, setDraft] = React.useState<'writing' | 'first' | 'guide' | null>(null)
  const shown = draft === 'first' || draft === 'guide'
  const drafting = React.useRef(false)
  // Whether the guide is on the sheet, for the editor's own handlers, which are set once.
  const guiding = React.useRef(false)
  React.useEffect(() => {
    guiding.current = draft === 'guide'
  }, [draft])
  const autosave = useAutosave({
    save: (text: string) => write('setAbout', { text }),
    onError: (e) =>
      toast("Couldn't save About our business", { description: toApiError(e).message }),
  })
  const save = (text: string) => {
    setTyped(text)
    if (drafting.current) return
    // Too long is never sent; shortening it saves it.
    if (aboutBusinessLength(normalizeAboutBusiness(text)) <= LIMIT) autosave.change(text)
    else autosave.discard()
  }

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: docExtensions(
      'For example: We sell outdoor gear to hikers in our own stores, online and through marketplaces.',
    ),
    content: about,
    contentType: 'markdown',
    editorProps: {
      attributes: { 'aria-label': 'About our business' },
      // While the guide is on the sheet its parts are filled in like a form's fields: a click on
      // one selects it whole, and Tab goes to the next one that is left. With none left, and with
      // Shift, Tab leaves the text as it always does.
      handleClick: (view, at) => {
        if (!guiding.current) return false
        const part = guidePartsOn(view.state.doc).find((p) => at > p.from && at < p.to)
        if (part) selectGuidePart(view, part)
        return !!part
      },
      handleKeyDown: (view, event) => {
        if (!guiding.current || event.key !== 'Tab' || event.shiftKey) return false
        const parts = guidePartsOn(view.state.doc)
        const next = parts.find((p) => p.from >= view.state.selection.to) ?? parts[0]
        if (next) selectGuidePart(view, next)
        return !!next
      },
    },
    onUpdate: ({ editor }) => save(editor.getMarkdown()),
  })
  // Count what the editor writes back, so the number never jumps on the first keystroke, as the
  // service counts it: the characters a person reads, once the text is in Footnote's form.
  const written = React.useMemo(() => editor?.getMarkdown() ?? about, [editor, about])
  const text = typed ?? written
  const length = aboutBusinessLength(normalizeAboutBusiness(text))
  const tooLong = length > LIMIT
  const defined = React.useMemo(() => definedInAbout(text, glossary.find), [text, glossary])

  const writeFirstVersion = () => {
    setDraft('writing')
    write('draftAbout', undefined).then(
      ({ text }) => {
        drafting.current = true
        editor.commands.setContent(text, { contentType: 'markdown' })
        setTyped(editor.getMarkdown())
        setDraft('first')
      },
      (e: unknown) => {
        setDraft(null)
        toast("Couldn't write a first version", { description: toApiError(e).message })
      },
    )
  }
  // The guide's first part is selected, so the first words typed take its place.
  const startFromGuide = () => {
    drafting.current = true
    editor.commands.setContent(ABOUT_BUSINESS_GUIDE, { contentType: 'markdown' })
    setTyped(editor.getMarkdown())
    setDraft('guide')
    const [first] = guidePartsOn(editor.state.doc)
    if (first) selectGuidePart(editor.view, first)
  }
  // The guide's parts nobody has put words in place of yet: with one left, it cannot be kept.
  const unfilled = draft === 'guide' ? aboutGuidePartsIn(typed ?? '') : []
  const keepDraft = () => {
    drafting.current = false
    setDraft(null)
    save(editor.getMarkdown())
  }
  const discardDraft = () => {
    editor.commands.setContent(about, { contentType: 'markdown' })
    setTyped(editor.getMarkdown())
    drafting.current = false
    setDraft(null)
  }

  const help = useHelpAside(me.name)
  const [paneRef, wide] = useWide<HTMLDivElement>()

  // Too long is not saved, and the footer says how to save it. A first version or the guide not
  // kept yet is not saved either, whatever the last save stored.
  const status = (
    <SaveStatus
      status={tooLong ? 'failed' : shown ? 'dirty' : autosave.status}
      retry={tooLong ? undefined : autosave.retry}
    />
  )

  return (
    <DocumentEditorShell
      editor={editor}
      paneRef={paneRef}
      header={
        <SiteHeader title={title} bare>
          {status}
          {setup && (
            <Button
              data-primary
              disabled={tooLong || length === 0 || draft !== null}
              onClick={() => {
                void autosave.flush().then(() => {
                  toast('Saved', {
                    description:
                      'Ask reads it from the next question, and an agent when it next connects.',
                  })
                  navigate('/inbox')
                })
              }}
            >
              Done
            </Button>
          )}
          <HeaderMore>
            <DropdownMenuItem onClick={() => help.setOpen(!help.open)}>
              <PanelRightIcon />
              {help.open ? 'Hide what to put here' : 'Show what to put here'}
            </DropdownMenuItem>
          </HeaderMore>
        </SiteHeader>
      }
      aside={
        help.open &&
        wide && (
          <ResizableAside
            side="right"
            storageKey="settings-help"
            defaultWidth={320}
            min={260}
            max={440}
            label="What to put here"
            className="border-l bg-background"
          >
            <Panel
              title="What to put here"
              onClose={() => help.setOpen(false)}
              closeLabel="Hide what to put here"
            >
              <div className="p-4 text-sm text-muted-foreground md:px-5 [&_li]:mt-2 [&_li:first-child]:mt-0 [&_ul]:ml-4 [&_ul]:list-disc">
                {helpText}
              </div>
            </Panel>
          </ResizableAside>
        )
      }
      footer={
        <DocFooter>
          <span className={cn('tabular-nums', tooLong && 'font-medium text-destructive')}>
            {length.toLocaleString('en-GB')} of {LIMIT.toLocaleString('en-GB')}
            <span className={cn(!tooLong && 'max-sm:sr-only')}>
              {' '}
              characters{tooLong && '. Shorten it to save'}
            </span>
          </span>
          <span className="hidden sm:inline">Markdown</span>
        </DocFooter>
      }
    >
      <Paper>
        <h2 className="text-2xl leading-tight font-bold tracking-tight sm:text-3xl">
          About our business
        </h2>
        <div className="mt-2 mb-6 space-y-2 border-b pb-5 text-sm text-muted-foreground sm:mb-8 [&_p]:max-w-reading">
          <p>Ask and agents read it as background, never as a source.</p>
          <p>Leave out numbers, dates, deals, legal conclusions, secrets and personal data.</p>
        </div>
        <h3 id="about-what" className="text-base font-semibold">
          What the company does
        </h3>
        <p className="mt-1 mb-4 max-w-reading text-sm text-muted-foreground">
          One or two sentences: what you sell, to whom, where and through which channels.
        </p>
        <RichTextEditor.Content className="text-base [&_.ProseMirror]:min-h-48! [&_.ProseMirror]:max-w-reading [&_.ProseMirror]:p-0!" />
        {shown && (
          <div
            role="group"
            aria-label={draft === 'guide' ? 'Guide' : 'First version'}
            className="mt-4 flex max-w-reading flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border bg-muted/50 px-3 py-2 text-sm"
          >
            <p className="text-muted-foreground">
              {draft === 'guide'
                ? 'Click a part in brackets, or press Tab, and type your own words. Not saved until you keep it.'
                : 'Written from your domains, metrics and definitions. Not saved until you keep it.'}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={discardDraft}>
                Discard
              </Button>
              <Button disabled={tooLong || length === 0 || unfilled.length > 0} onClick={keepDraft}>
                Keep it
              </Button>
            </div>
          </div>
        )}
        {length === 0 && !shown && (
          <div className="mt-4 flex flex-wrap gap-2">
            {draftable && (
              <Button variant="outline" disabled={draft === 'writing'} onClick={writeFirstVersion}>
                {draft === 'writing' ? 'Writing…' : 'Write a first version for me'}
              </Button>
            )}
            <Button variant="outline" disabled={draft === 'writing'} onClick={startFromGuide}>
              Start from the guide
            </Button>
          </div>
        )}
        {/* Said as it is typed, so a screen reader hears it too. */}
        <div aria-live="polite">
          {defined.length > 0 && (
            <ul className="mt-4 max-w-reading space-y-1 text-sm text-muted-foreground">
              {defined.map((d) => (
                <li key={d.name}>
                  <a
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                    href={href(`/definitions/${encodeURIComponent(d.name)}`)}
                  >
                    {d.name}
                  </a>{' '}
                  {definedWords(d)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-4 text-sm text-muted-foreground">
          <p>Words and what they mean go in Definitions.</p>
          <a href={href('/definitions/new')} className={cn(buttonVariants({ variant: 'outline' }))}>
            New term
          </a>
        </div>
      </Paper>
      {help.open && !wide && (
        <div className="border-t bg-background p-4 text-sm text-muted-foreground [&_li]:mt-2 [&_li:first-child]:mt-0 [&_ul]:ml-4 [&_ul]:list-disc">
          <p className="mb-2 font-medium text-foreground">What to put here</p>
          {helpText}
        </div>
      )}
    </DocumentEditorShell>
  )
}
