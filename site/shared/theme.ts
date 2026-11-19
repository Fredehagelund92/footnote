/*
  The reader's theme, the same on the landing page and in the docs: light unless they picked dark,
  as the landing page was approved, and kept in the browser under one key for the whole site.
*/

export const themeKey = 'footnote-theme'

/** Runs in the head before the page paints, so a dark page never flashes light. */
export const themeScript = `try{document.documentElement.dataset.theme=localStorage.getItem('${themeKey}')==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}`
