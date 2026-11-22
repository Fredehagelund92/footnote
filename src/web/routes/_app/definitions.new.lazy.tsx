import { createLazyFileRoute } from '@tanstack/react-router'
import { DefinitionEditor } from '@/pages/definition-editor'

export const Route = createLazyFileRoute('/_app/definitions/new')({ component: Editor })

// A new term starts from its address: another word or "Another name for" is a new start.
function Editor() {
  const { name, sameAs } = Route.useSearch()
  return <DefinitionEditor key={`${name ?? ''}|${sameAs ?? ''}`} />
}
