/*
  The reader's theme, kept in the browser under one key for the whole site, so a pick on the
  landing page holds in the docs and back. Without a pick the landing page opens dark, as it was
  approved, and the docs open light.
*/

export const themeKey = 'footnote-theme'

type Theme = 'light' | 'dark'

const scriptFor = (fallback: Theme) => {
  const other = fallback === 'dark' ? 'light' : 'dark'
  return `try{document.documentElement.dataset.theme=localStorage.getItem('${themeKey}')==='${other}'?'${other}':'${fallback}'}catch(e){document.documentElement.dataset.theme='${fallback}'}`
}

/** Runs in the head before the page paints, so a page never flashes the other theme. Light without a pick, for the docs. */
export const themeScript = scriptFor('light')

/** The same, dark without a pick, for the landing page. */
export const landingThemeScript = scriptFor('dark')
