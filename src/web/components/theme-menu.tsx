import { MonitorIcon, MoonIcon, SunIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTheme, type Theme } from '@/lib/theme-context'

// The theme control: every header's, the Docs area's among them, and the three choices for a menu
// that already exists. One module of its own, so the docs site carries it without the app's header.

const themeIcon = { light: SunIcon, dark: MoonIcon, system: MonitorIcon }

/** The three themes as a radio group, for a menu that already exists (an editor's More menu). */
export function ThemeChoices() {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
      {(['light', 'dark', 'system'] as Theme[]).map((t) => {
        const I = themeIcon[t]
        return (
          <DropdownMenuRadioItem key={t} value={t}>
            <I />
            {t[0]!.toUpperCase() + t.slice(1)}
          </DropdownMenuRadioItem>
        )
      })}
    </DropdownMenuRadioGroup>
  )
}

/**
 * The theme, as a small bordered icon button at the right end of every header: its glyph shows the
 * current choice; a tiny menu offers all three with a check, so nothing is hidden behind a cycle.
 */
export function ThemeMenu() {
  const { theme } = useTheme()
  const Icon = themeIcon[theme]
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`Theme: ${theme[0]!.toUpperCase()}${theme.slice(1)}`}
                />
              }
            />
          }
        >
          <Icon />
        </TooltipTrigger>
        <TooltipContent>Light / Dark / System</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-36">
        <ThemeChoices />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
