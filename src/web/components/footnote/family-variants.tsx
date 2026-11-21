import * as React from 'react'
import { ChevronDownIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Family } from '@/lib/definitions'
import { useShowMore } from '@/hooks/use-show-more'
import { ShowMoreButton } from '@/components/footnote/show-more'

/**
 * A family's variants, on its own page and nowhere else (FR-142): each with the values that tell
 * it apart, which a menu per axis narrows ("Currency: EUR"). A family can have thousands, so the
 * list grows in steps.
 */
export function FamilyVariants({ family }: { family: Family }) {
  const id = React.useId()
  const [chosen, setChosen] = React.useState<(string | null)[]>(() => family.by.map(() => null))
  const valuesOf = React.useMemo(
    () =>
      family.by.map((_, i) =>
        [...new Set(family.variants.map((v) => v.values[i] ?? ''))]
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, 'en')),
      ),
    [family],
  )
  const matching = family.variants.filter((v) =>
    chosen.every((value, i) => value === null || v.values[i] === value),
  )
  const { shown, more, next, showMore } = useShowMore(matching, 20, 100)
  const total = family.variants.length.toLocaleString('en-GB')
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-sm font-semibold">
        Variants{' '}
        <span className="font-normal text-muted-foreground tabular-nums">
          {matching.length === family.variants.length
            ? total
            : `${matching.length.toLocaleString('en-GB')} of ${total}`}
        </span>
      </h3>
      <div className="flex flex-wrap gap-2">
        {family.by.map((axis, i) => (
          <DropdownMenu key={axis}>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              {axis}: {chosen[i] ?? 'any'}
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 w-48 overflow-y-auto">
              <DropdownMenuRadioGroup
                value={chosen[i] ?? ''}
                onValueChange={(value) =>
                  setChosen((was) => was.map((x, j) => (j === i ? (value as string) || null : x)))
                }
              >
                <DropdownMenuRadioItem value="" closeOnClick>
                  Any
                </DropdownMenuRadioItem>
                {valuesOf[i]!.map((value) => (
                  <DropdownMenuRadioItem key={value} value={value} closeOnClick>
                    {value}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      </div>
      <table className="w-full table-fixed border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-2 font-normal">Variant</th>
            {family.by.map((axis) => (
              <th key={axis} className="w-24 py-1.5 pr-2 font-normal @md:w-32">
                {axis}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((v) => (
            <tr key={v.name} className="border-b">
              <td className="truncate py-1.5 pr-2" title={v.name}>
                {v.name}
              </td>
              {family.by.map((axis, i) => (
                <td key={axis} className="truncate py-1.5 pr-2 text-muted-foreground">
                  {v.values[i]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ShowMoreButton more={more} next={next} onClick={showMore} label="variants" />
    </section>
  )
}
