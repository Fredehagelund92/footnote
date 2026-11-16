import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'
import { InboxPage } from '@/pages/inbox'
import { inboxSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/inbox/')({
  validateSearch: inboxSearch,
  component: InboxPage,
  // The reviews are read with the shell but not waited for (laterQueries): opened first, the
  // Inbox waits for them here.
  pendingComponent: () => <Loading shape="page" />,
})
