import { Page } from '@/components/site-header'
import { NotFound } from '@/components/heed/not-found'
import { useRoute } from '@/lib/router'

/** An address the app does not know: it says so, under the address that was asked for. */
export function NotFoundPage() {
  const { path } = useRoute()
  return (
    <Page title="Page not found">
      <NotFound
        title="There is no page at this address"
        way={{ href: '/inbox', label: 'Go to the Inbox' }}
      >
        Nothing lives at {path}. The link may be old or mistyped.
      </NotFound>
    </Page>
  )
}
