import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { FieldsDiff, TextComparison } from '@/components/footnote/source-review'
import { Loadable } from '@/components/footnote/load-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { versionPairQuery } from '@/api/queries'
import { useMe } from '@/lib/workspace'
import { compareWith, relativeDate, type Version } from '@/model/history'

// A version of an item in History, compared with any other version agents got, the way the review
// compares a suggestion: the same Fields table and text, the earlier version as before and the
// later one as after, each column named for its version. It opens on the version just before; the
// first version opens compared with the next one. An item with one version shows it as a new item
// does, the earlier column empty.
// Its own module, so the item page loads the comparison only once a version is opened.

const nameOf = (v: Version) => `Version ${v.v}`

export default function HistoryComparison({
  itemId,
  versions,
  viewing,
}: {
  itemId: string
  versions: readonly Version[]
  viewing: Version
}) {
  const id = React.useId()
  const me = useMe()
  const others = versions.filter((v) => v.comparable && v.v !== viewing.v)
  const [otherV, setOtherV] = React.useState(() => compareWith(versions, viewing)?.v)
  const other = others.find((v) => v.v === otherV)
  const [early, late] = other && other.v > viewing.v ? [viewing, other] : [other, viewing]
  // With nothing to compare it with, the version alone: read as a pair of itself.
  const pair = useQuery(versionPairQuery(itemId, early?.v ?? late.v, late.v))
  const labels = { before: early ? nameOf(early) : 'Before', after: nameOf(late) }
  return (
    <div className="flex flex-col gap-4">
      {other && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-with`} className="text-sm font-medium">
            Compared with
          </label>
          <Select
            items={others.map((v) => ({
              label: `${nameOf(v)}, ${relativeDate(v.on)}`,
              value: v.v,
            }))}
            value={other.v}
            onValueChange={(v) => setOtherV(Number(v))}
          >
            <SelectTrigger id={`${id}-with`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {others.map((v) => (
                  <SelectItem key={v.v} value={v.v}>
                    {nameOf(v)}, {relativeDate(v.on)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      )}
      <Loadable
        what="the two versions"
        query={pair}
        skeleton={
          <div className="flex flex-col gap-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        }
      >
        {pair.data ? (
          <div className="flex flex-col gap-4">
            <FieldsDiff
              before={early ? pair.data.fields.before : null}
              after={pair.data.fields.after}
              person={me.name}
              labels={labels}
              oneSide="As this version made them"
            />
            <TextComparison
              before={early ? pair.data.source.before : ''}
              after={pair.data.source.after}
              labels={labels}
              missing="Nothing: this version made the item."
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            One of the two made no version of its own, so there is nothing to compare.
          </p>
        )}
      </Loadable>
    </div>
  )
}
