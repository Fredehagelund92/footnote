import { createLazyFileRoute } from '@tanstack/react-router'
import { SharedChatPage } from '@/pages/shared-chat'

export const Route = createLazyFileRoute('/_app/shared/$id')({ component: Page })

function Page() {
  const { id } = Route.useParams()
  return <SharedChatPage key={id} id={id} />
}
