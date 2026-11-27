/*
  The reader's theme, kept in the browser under one key for the whole site, so a pick on the
  landing page holds in the docs and back. Without a pick every page opens dark, as the design was
  approved.
*/

export const themeKey = 'footnote-theme'

/** Runs in the head before the page paints, so a page never flashes the other theme. */
export const themeScript = `try{document.documentElement.dataset.theme=localStorage.getItem('${themeKey}')==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`
