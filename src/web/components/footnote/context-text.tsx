import { cn } from '@/lib/utils'
import { MentionText } from '@/components/footnote/mention-chip'
import { MarkedWords } from '@/components/footnote/source-text'

/** A passage of context text: its Markdown marks drawn, its mentions as chips. */
function Words({ text, dense }: { text: string; dense?: boolean }) {
  return (
    <MarkedWords
      text={text}
      code={dense ? 'text-xs' : 'text-sm'}
      words={(t) => <MentionText text={t} />}
    />
  )
}

/**
 * Stored context text as the editor wrote it, read-only: paragraphs, lists and quotes, with
 * their marks and links, and mentions as chips. `dense` is the quick view's smaller text.
 */
export function ContextText({ text, dense }: { text: string; dense?: boolean }) {
  return text.split('\n\n').map((para, i) =>
    /^(- |\d\. )/.test(para) ? (
      <ul
        key={i}
        className={cn(
          'list-disc marker:text-muted-foreground',
          dense ? 'ml-5 space-y-1' : 'ml-6 space-y-1.5',
        )}
      >
        {para.split('\n').map((li, j) => (
          <li key={j}>
            <Words text={li.replace(/^(- |\d\. )/, '')} dense={dense} />
          </li>
        ))}
      </ul>
    ) : para.startsWith('> ') ? (
      <blockquote
        key={i}
        className={cn('border-l-2 text-muted-foreground', dense ? 'pl-3' : 'pl-4')}
      >
        <Words text={para.replace(/^> ?/gm, '')} dense={dense} />
      </blockquote>
    ) : (
      <p key={i}>
        <Words text={para} dense={dense} />
      </p>
    ),
  )
}
