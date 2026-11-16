import { toast } from 'sonner'
import { ChevronsUpDownIcon } from '@/components/icons'
import { PersonAvatar } from '@/components/heed/bits'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { mockControls } from '@/api'
import { useApiWrite, useWorkspace } from '@/api/queries'
import { profilesIn } from '@/lib/demo-profiles'
import { navigate } from '@/lib/router'
import { useMe } from '@/lib/workspace'

/** The demo's people and who the visitor is now, or nothing where there is no demo to switch in. */
export function useViewAs() {
  const workspace = useWorkspace()
  const me = useMe()
  // The mock has a sandbox too, but it is not the demo install: its journeys sign in by the picker.
  const profiles = mockControls ? [] : profilesIn(workspace)
  return profiles.length ? { name: me.name, profiles } : null
}

/** The people to view the demo as, as radio items for a menu that already exists. */
export function ViewAsChoices() {
  const signIn = useApiWrite('signIn')
  const viewAs = useViewAs()
  if (!viewAs) return null
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>View the demo as</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={viewAs.name}
        onValueChange={(value: string) => {
          const name = value
          if (name === viewAs.name) return
          // The page may be one the next person can't open, so they start where the app
          // opens for them.
          signIn
            .mutateAsync({ name })
            .then(() => navigate('/'))
            .catch(() =>
              toast.error("Couldn't switch", {
                description: 'You are still viewing as yourself. Try again.',
              }),
            )
        }}
      >
        {viewAs.profiles.map((p) => (
          <DropdownMenuRadioItem
            key={p.name}
            value={p.name}
            closeOnClick
            className="items-start gap-2 py-2"
          >
            <PersonAvatar name={p.name} size={28} />
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate font-medium">
                {p.name}
                <span className="font-normal text-muted-foreground"> · {p.part}</span>
              </span>
              <span className="text-xs text-pretty text-muted-foreground">{p.line}</span>
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  )
}

/**
 * The demo's "View as" switch, in the corner of every page header: the admin, a domain owner and
 * a plain reader, each with a line saying what they can do, so a visitor sees the same company as
 * each of them without signing out. Only the demo shows it: the invented company, found by its
 * sandbox domain (nothing for an install with its own data).
 */
export function ViewAs() {
  const viewAs = useViewAs()
  if (!viewAs) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            aria-label={`View as: ${viewAs.name}`}
            className="max-sm:size-7 max-sm:px-0"
          />
        }
      >
        <PersonAvatar name={viewAs.name} size={16} />
        <span className="max-sm:hidden">View as</span>
        <span className="max-w-32 truncate font-normal text-muted-foreground max-md:hidden">
          {viewAs.name}
        </span>
        <ChevronsUpDownIcon className="max-sm:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <ViewAsChoices />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
