import { ChevronsUpDownIcon, LogOutIcon, PlugIcon } from '@/components/icons'
import { PersonAvatar } from '@/components/footnote/bits'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { ThemeChoices } from '@/components/site-header'
import { open } from '@/lib/events'
import { useApiWrite } from '@/api/queries'
import { rememberSignedOut } from '@/lib/demo-profiles'
import { useMe } from '@/lib/workspace'

// The sidebar block's user menu: Connect an agent and Sign out. Help sits in the sidebar's foot, the theme in the header; a phone's deep pages give up the header's theme, so it is here too.
export function NavUser() {
  const { isMobile, setOpenMobile } = useSidebar()
  const me = useMe()
  const signOut = useApiWrite('signOut')

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="h-auto min-h-12 aria-expanded:bg-muted" />
            }
          >
            <PersonAvatar name={me.name} size={32} />
            {/* Who and what they own wrap rather than being cut: "Owner of Memberships, admin". */}
            <div className="grid flex-1 text-left text-sm leading-tight wrap-break-word">
              <span className="font-medium">{me.name}</span>
              <span className="text-xs text-muted-foreground">{me.role}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-60"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <PersonAvatar name={me.name} size={32} />
                  <div className="grid flex-1 text-left text-sm leading-tight wrap-break-word">
                    <span className="font-medium text-foreground">{me.name}</span>
                    <span className="text-xs">{me.role}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  setOpenMobile(false)
                  open('connect')
                }}
              >
                <PlugIcon />
                Connect an agent
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {isMobile && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Theme</DropdownMenuLabel>
                  <ThemeChoices />
                </DropdownMenuGroup>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                // Signed out, the app moves to the sign-in page (App.tsx). The demo then shows
                // everyone to pick from, instead of opening as its admin again.
                rememberSignedOut(true)
                signOut.mutate()
              }}
            >
              <LogOutIcon />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
