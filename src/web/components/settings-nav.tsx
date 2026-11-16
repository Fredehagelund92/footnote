import {
  ArrowLeftIcon,
  BotIcon,
  LayersIcon,
  PlugIcon,
  SlidersHorizontalIcon,
  UsersIcon,
  WrenchIcon,
} from '@/components/icons'
import { memberSections } from '@/lib/settings-access'
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useConnected } from '@/lib/integrations'
import { BACK_TO_APP } from '@/lib/brand'
import { useMe } from '@/lib/workspace'

// Inside Settings the app sidebar gives way to the settings navigation, as Linear's does: a way
// back to Heed on top, then six sections in three groups. No tabs anywhere in Settings.

const settingsSections = [
  {
    group: 'Workspace',
    items: [
      { id: 'general', title: 'General', icon: SlidersHorizontalIcon },
      { id: 'domains', title: 'Domains and owners', icon: LayersIcon },
      { id: 'people', title: 'People', icon: UsersIcon },
    ],
  },
  {
    group: 'Connections',
    items: [
      { id: 'agents', title: 'Agents and access', icon: BotIcon },
      { id: 'integrations', title: 'Integrations', icon: PlugIcon },
    ],
  },
  { group: 'System', items: [{ id: 'advanced', title: 'Advanced', icon: WrenchIcon }] },
] as const

export function SettingsNav({ section, close }: { section: string; close: () => void }) {
  const connected = useConnected()
  const me = useMe()
  // Someone who isn't an admin sees the places they can use: an owner's domains and people, and their agents.
  const allowed = memberSections(me.owns.length > 0)
  const sections = me.admin
    ? settingsSections
    : settingsSections
        .map((g) => ({ ...g, items: g.items.filter((i) => allowed.includes(i.id)) }))
        .filter((g) => g.items.length)
  return (
    <>
      <SidebarHeader className="h-bar justify-center border-b px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={BACK_TO_APP} render={<a href="/inbox" onClick={close} />}>
              <ArrowLeftIcon />
              <span>{BACK_TO_APP}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent label="Settings">
        {sections.map((g) => (
          <SidebarGroup key={g.group}>
            <SidebarGroupLabel>{g.group}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      tooltip={item.title}
                      isActive={section === item.id}
                      render={<a href={`/settings/${item.id}`} onClick={close} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                    {item.id === 'integrations' && connected.length > 0 && (
                      <SidebarMenuBadge>{connected.length}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </>
  )
}
