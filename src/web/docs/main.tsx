import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import '../styles/index.css'
import { DOCS_HOME } from '@/lib/docs'
import { DocsSite } from '@/pages/docs'
import { ThemeProvider } from '@/lib/theme'
import { slugAt } from './place'

// The static docs site in the browser (npm run docs:build): each page arrives drawn (render.tsx),
// and this makes it work, the search, the theme and the copy buttons, on the address it was opened
// at. The theme is the app's: the same choice, kept under the same name.

hydrateRoot(
  document.getElementById('root')!,
  <StrictMode>
    <ThemeProvider>
      <DocsSite
        slug={slugAt(window.location.pathname, DOCS_HOME)}
        query={new URLSearchParams(window.location.search)}
        go={(href) => window.location.assign(href)}
      />
    </ThemeProvider>
  </StrictMode>,
)
