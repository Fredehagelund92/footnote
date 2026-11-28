import * as React from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { ChevronDownIcon, MinusIcon, PlusIcon, QuoteIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { RichTextEditor } from '@/components/editor'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// The toolbar of the one document editor Footnote writes long text in, a flat strip under a hairline.
// The context editor, the term editor and About our business share it (and docExtensions).

/* ---------- editorcn's toolbar, trimmed to what markdown carries ---------- */

/**
 * Which sides of a row that scrolls across have more beyond them: the toolbar fades out at that
 * side (editor/style.css), so a phone shows the row goes on rather than ending in a cut button.
 */
function useMoreBeside(ref: React.RefObject<HTMLElement | null>) {
  const [more, setMore] = React.useState<'start' | 'end' | 'both' | undefined>()
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const start = el.scrollLeft > 1
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setMore(start ? (end ? 'both' : 'start') : end ? 'end' : undefined)
    }
    read()
    el.addEventListener('scroll', read, { passive: true })
    const watch = new ResizeObserver(read)
    watch.observe(el)
    if (el.firstElementChild) watch.observe(el.firstElementChild)
    return () => {
      el.removeEventListener('scroll', read)
      watch.disconnect()
    }
  }, [ref])
  return more
}

const ACTIVE_ITEM = "rounded-md py-1 pl-2 text-sm [&_svg:not([class*='size-'])]:size-3.5"

const TEXT_STYLES = [
  { label: 'Paragraph', value: '0', className: '' },
  { label: 'Heading 2', value: '2', className: 'font-semibold' },
  { label: 'Heading 3', value: '3', className: 'font-medium' },
]

function TextStyleMenu({ editor }: { editor: Editor | null }) {
  const value =
    useEditorState({
      editor,
      selector: ({ editor: e }) =>
        e ? String([2, 3].find((l) => e.isActive('heading', { level: l })) ?? 0) : '0',
    }) ?? '0'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="w-26 justify-between" />}>
        {TEXT_STYLES.find((s) => s.value === value)?.label}
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-32 p-1">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const level = Number(next) as 0 | 2 | 3
            const chain = editor?.chain().focus()
            ;(level ? chain?.setHeading({ level }) : chain?.setParagraph())?.run()
          }}
        >
          {TEXT_STYLES.map((s) => (
            <DropdownMenuRadioItem
              key={s.value}
              value={s.value}
              className={cn(ACTIVE_ITEM, s.className)}
            >
              {s.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function InsertMenu({ editor }: { editor: Editor | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" />}>
        <PlusIcon className="size-4" />
        Insert
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36 p-1">
        <DropdownMenuItem
          className="rounded-md py-1 text-sm [&_svg]:size-3.5!"
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <QuoteIcon />
          Quote
        </DropdownMenuItem>
        <DropdownMenuItem
          className="rounded-md py-1 text-sm [&_svg]:size-3.5!"
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
        >
          <MinusIcon />
          Divider
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Toolbar({ editor, className }: { editor: Editor | null; className?: string }) {
  const scroller = React.useRef<HTMLDivElement>(null)
  const more = useMoreBeside(scroller)
  return (
    <div className={cn('flex h-tool shrink-0 items-center border-b bg-background', className)}>
      <div
        ref={scroller}
        data-more={more}
        className="rte-toolbar-scroll w-full max-w-full scrollbar-none overflow-x-auto px-2 md:px-4 [&::-webkit-scrollbar]:hidden"
      >
        <RichTextEditor.Toolbar className="flex-nowrap! justify-start! border-0! bg-transparent! px-1! py-1! sm:w-max [&_.rte-controls-group>button:not([data-state=on]):not([aria-pressed=true])]:text-foreground! [&>*]:shrink-0">
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Undo />
            <RichTextEditor.Redo />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <TextStyleMenu editor={editor} />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.Bold />
            <RichTextEditor.Italic />
            <RichTextEditor.Code />
            <RichTextEditor.Link />
            <RichTextEditor.ClearFormatting />
          </RichTextEditor.ControlsGroup>
          <span aria-hidden className="mx-1 h-4 w-px bg-border" />
          <RichTextEditor.ControlsGroup>
            <RichTextEditor.BulletList />
            <RichTextEditor.OrderedList />
          </RichTextEditor.ControlsGroup>
          <RichTextEditor.ControlsGroup>
            <InsertMenu editor={editor} />
          </RichTextEditor.ControlsGroup>
        </RichTextEditor.Toolbar>
      </div>
    </div>
  )
}
