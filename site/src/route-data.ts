import { defineRouteMiddleware } from '@astrojs/starlight/route-data'
import { sitePages } from '../lib/pages.ts'
import { repository } from '../lib/repository.ts'
import { followsMain, readSettings } from '../lib/settings.ts'

const files = new Map(sitePages().map(({ slug, file }) => [slug, file]))
// Set here, as each page is drawn, and not in the content collection, whose entries Astro keeps
// from one build to the next while their files stay the same.
const banner = followsMain(readSettings(process.env))
  ? 'These pages follow the main branch, ahead of any release. They may name what no release has yet.'
  : undefined

export const onRequest = defineRouteMiddleware(({ locals }) => {
  const route = locals.starlightRoute
  // "On this page" opens with the page's own title, where Starlight writes "Overview".
  if (route.toc?.items[0]) route.toc.items[0].text = route.entry.data.title
  // Edit page opens the page's Markdown on main, whichever version is read: a change lands there.
  const file = files.get(route.entry.id)
  route.editUrl = file ? new URL(`${repository}/edit/main/${file}`) : undefined
  if (banner) route.entry.data.banner = { content: banner }
})
