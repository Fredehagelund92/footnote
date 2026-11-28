import { BotIcon, PlugIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import claude from '@/assets/logos/claude.svg'
import { useAgentConnections } from '@/api/queries'
import { agentInSentence, claudeAppLink } from '@/lib/agents'
import { toolsOn } from '@/lib/connect'
import { open } from '@/lib/events'
import { toast } from '@/lib/toast'
import { useMe } from '@/lib/workspace'
import { appFamilyOf } from '@domain/app-family'

/*
  Write with Claude (W3): one press from nothing written to the person's own agent with the words to
  start it (writePrompt and finishPrompt in lib/agents.ts, never the words anyone asked). Claude's app
  opens on a new chat with the prompt in its box, and the person sends it. Another agent of theirs
  that may write a draft gets the prompt copied, to paste. With none, Connect an agent opens. The
  agent writes a draft here with the person, and looks again when they write to it: no agent sees
  an edit between turns, so the words say so.
*/

type WriteWith =
  | { via: 'claude'; label: string; href: string }
  | { via: 'copy'; label: string; agent: string; prompt: string }
  | { via: 'connect'; label: string }

/** How the person writes with their agent: Claude's app first, then another app of theirs. */
export function useWriteWith(prompt: string): WriteWith {
  const me = useMe()
  const mine = useAgentConnections().filter(
    (r) => r.kind === 'app' && r.who === me.name && toolsOn(r).includes('write_draft'),
  )
  const app = mine.find((r) => appFamilyOf(r.agent) === 'claude_ai')
  if (app) return { via: 'claude', label: 'Write with Claude', href: claudeAppLink(prompt) }
  const other = mine[0]
  if (other) {
    // The name people know it by, never the one a program reported: "your agent" for a proxy.
    const agent = agentInSentence(other)
    return { via: 'copy', label: `Write with ${agent}`, agent, prompt }
  }
  return { via: 'connect', label: 'Write with your agent' }
}

/** What a press does beyond following a link: the toast, the copy, or the dialog. */
function press(w: WriteWith) {
  if (w.via === 'claude')
    toast('Claude opens with the prompt ready', {
      description:
        'Send it there. Claude writes a draft here with you, and looks again when you write to it.',
    })
  else if (w.via === 'copy')
    void navigator.clipboard?.writeText(w.prompt).then(
      () =>
        toast('Prompt copied', {
          description: `Paste it into ${w.agent}. It writes a draft here with you, and looks again when you write to it.`,
        }),
      () => toast.error("It wasn't copied", { description: 'Try again in a moment.' }),
    )
  else open('connect')
}

const Mark = ({ w }: { w: WriteWith }) =>
  w.via === 'claude' ? (
    <img src={claude} alt="" aria-hidden className="size-4" data-icon="inline-start" />
  ) : w.via === 'copy' ? (
    <BotIcon data-icon="inline-start" />
  ) : (
    <PlugIcon data-icon="inline-start" />
  )

/** The button: a link into Claude's app, or a press that copies the prompt or connects an agent. */
export function WriteWithButton({
  prompt,
  variant = 'outline',
  className,
}: {
  prompt: string
  variant?: 'outline' | 'ghost'
  className?: string
}) {
  const w = useWriteWith(prompt)
  return w.via === 'claude' ? (
    <Button
      variant={variant}
      className={className}
      nativeButton={false}
      render={<a href={w.href} onClick={() => press(w)} />}
    >
      <Mark w={w} />
      {w.label}
    </Button>
  ) : (
    <Button variant={variant} className={className} onClick={() => press(w)}>
      <Mark w={w} />
      {w.label}
    </Button>
  )
}

/** The same, as a row of a menu, such as the editor's More. */
export function WriteWithMenuItem({ prompt }: { prompt: string }) {
  const w = useWriteWith(prompt)
  return w.via === 'claude' ? (
    <DropdownMenuItem render={<a href={w.href} />} onClick={() => press(w)}>
      <Mark w={w} />
      {w.label}
    </DropdownMenuItem>
  ) : (
    <DropdownMenuItem onClick={() => press(w)}>
      <Mark w={w} />
      {w.label}
    </DropdownMenuItem>
  )
}
