import { createRootRoute } from '@tanstack/react-router'
import App from '@/App'
import { AppErrorPage } from '@/pages/app-error'
import { rootSearch } from '@/lib/search'

export const Route = createRootRoute({
  validateSearch: rootSearch,
  component: App,
  // The app's own page when it cannot start; a page's own failure stays in its frame (App.tsx).
  errorComponent: AppErrorPage,
})
