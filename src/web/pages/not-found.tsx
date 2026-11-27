import { Page } from '@/components/site-header'
import { NotFound } from '@/components/footnote/not-found'
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
        {/* The address stays whole on a line when it fits one, with its full stop: never cut at one of its hyphens. */}
        Nothing lives at <span className="inline-block max-w-full">{path}.</span> The link may be
        old or mistyped.
      </NotFound>
    </Page>
  )
}
