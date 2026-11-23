import { BookAIcon, ExternalLinkIcon, NotebookPenIcon, PencilIcon } from '@/components/icons'
import { DefinitionDetails, TypeTile } from '@/components/footnote/definition'
import { FamilyVariants } from '@/components/footnote/family-variants'
import { DefinitionRelations, FamilyRelations } from '@/components/footnote/definition-relations'
import {
  FamilyDeclared,
  SplitFamily,
  useMaySplit,
  useWhoDecides,
} from '@/components/footnote/family-split'
import { Canvas, Paper } from '@/components/footnote/doc'
import { SiteHeader } from '@/components/site-header'
import { useSidebar } from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useQuery } from '@tanstack/react-query'
import { definitionPageQuery } from '@/api/queries'
import { kindName, useGlossary, type Definition } from '@/lib/definitions'
import { href, navigate } from '@/lib/router'
import { Loadable, PageSkeleton } from '@/components/footnote/load-state'
import { NotFound } from '@/components/footnote/not-found'

// A definition's own page, read-only like its peek, on the same paper sheet as a context item's
// page. A synced metric or dimension can't be edited here at all: its page says where to change it.
// Only a term has Edit.

export function DefinitionPage({ name }: { name: string }) {
  const glossary = useGlossary()
  const { isMobile } = useSidebar()
  const page = useQuery(definitionPageQuery(name))
  // The page's own read shows it; the glossary knows it exists while that read loads.
  const d = page.data ?? glossary.find(name)
  if (!d)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SiteHeader title="Definitions" icon={<BookAIcon />} />
        <NotFound
          title="There is no definition here"
          way={{ href: '/definitions', label: 'Open Definitions' }}
        >
          Nothing is called “{name}”. It may have been renamed.
        </NotFound>
      </div>
    )
  const subject = glossary.meaningOf(d)
  const writable = d.synced && subject.type === 'metric'
  const writeContext = (
    <Button
      nativeButton={false}
      aria-label="Write context"
      render={<a href={href('/context/new', { metric: d.name, domain: d.domain })} />}
    >
      <NotebookPenIcon data-icon="inline-start" />
      <span className="max-sm:sr-only">Write context</span>
    </Button>
  )
  // Only a source that names the model file links to it: a dead link would break the rule it serves.
  const fileUrl = d.fileUrl
  const openSource = fileUrl && (
    <Button
      variant="outline"
      nativeButton={false}
      aria-label="Open in source"
      render={<a href={fileUrl} target="_blank" rel="noreferrer" />}
    >
      <ExternalLinkIcon data-icon="inline-start" />
      <span className="max-sm:sr-only">Open in source</span>
    </Button>
  )
  const main = writable ? (
    <>
      {writeContext}
      {!isMobile && openSource}
    </>
  ) : (
    openSource
  )
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SiteHeader
        title={d.name}
        icon={<BookAIcon />}
        deep={{ href: href('/definitions'), label: 'Back to Definitions' }}
        more={
          writable &&
          fileUrl && (
            <DropdownMenuItem render={<a href={fileUrl} target="_blank" rel="noreferrer" />}>
              <ExternalLinkIcon />
              Open in source
            </DropdownMenuItem>
          )
        }
      >
        {d.synced ? (
          main
        ) : (
          <Button onClick={() => navigate(`/definitions/${encodeURIComponent(d.name)}/edit`)}>
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        )}
      </SiteHeader>
      <Canvas className="min-h-0 flex-1 overflow-y-auto">
        <Paper className="@container">
          <Loadable
            what="this definition"
            skeleton={<PageSkeleton />}
            errorClassName="p-0"
            refreshClassName="mb-5 rounded-frame border"
            query={page}
          >
            <div className="mb-6 flex items-center gap-3 sm:mb-8">
              <TypeTile d={d} size="lg" />
              <div className="min-w-0">
                <h2 className="text-2xl leading-tight font-bold tracking-tight sm:text-3xl">
                  {d.name}
                </h2>
                <p className="text-sm text-muted-foreground">{kindName(d)}</p>
              </div>
            </div>
            <DefinitionDetails
              d={d}
              variants={d.family && <FamilyVariants key={d.name} family={d.family} />}
              relations={
                d.family ? (
                  <FamilyBuilt d={d} />
                ) : (
                  d.synced && d.type === 'metric' && <DefinitionRelations d={d} />
                )
              }
            />
          </Loadable>
        </Paper>
      </Canvas>
    </div>
  )
}

/**
 * How a family was found and how its variants are worked out, with Split for an owner of its
 * domain or an admin (D3), who decides for anyone else, and where a declared one is changed (D4).
 */
function FamilyBuilt({ d }: { d: Definition }) {
  const maySplit = useMaySplit(d)
  const who = useWhoDecides(d)
  return (
    <div className="flex flex-col gap-4">
      <FamilyRelations
        family={d.family!}
        tool={d.tool ?? 'its tool'}
        action={maySplit && <SplitFamily d={d} />}
        note={who}
      />
      {d.family!.declared && <FamilyDeclared d={d} />}
    </div>
  )
}
