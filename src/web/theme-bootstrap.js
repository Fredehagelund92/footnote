// Applies the theme before first paint, so dark never flashes light: ?theme= in the address, else
// the saved choice, else the system's. Inlined into <head> by vite.config.ts, which puts the
// storage keys from lib/brand.ts in place of THEME_KEY and STORAGE_PREFIX. Keep this file
// dependency free and plain JavaScript: it runs before any bundle loads. lib/theme.tsx keeps the
// choice under the same key, and tests/web/theme-bootstrap.test.ts covers both.
//
// First it moves what the browser kept before the product was renamed Footnote: keys that start
// heed- (the product's slug then) or heed. take their names now, once, unless the new name holds
// something already, so the theme, the panes and the Ask chats stay (docs/operations.md,
// "Upgrade from Heed 0.1").
;(function () {
  try {
    ;[window.localStorage, window.sessionStorage].forEach(function (store) {
      var keys = []
      for (var i = 0; i < store.length; i++) keys.push(store.key(i))
      keys.forEach(function (key) {
        if (!key || key.indexOf(STORAGE_PREFIX) === 0 || key.indexOf('footnote.') === 0) return
        var former = /^heed([-.])([\s\S]*)$/.exec(key || '')
        if (!former) return
        var renamed = former[1] === '-' ? STORAGE_PREFIX + former[2] : 'footnote.' + former[2]
        if (store.getItem(renamed) === null) store.setItem(renamed, store.getItem(key))
        store.removeItem(key)
      })
    })
  } catch {
    // Storage can be blocked. Then there is nothing to move either.
  }
  var theme = 'system'
  try {
    var asked = new URLSearchParams(window.location.search).get('theme')
    var saved = window.localStorage.getItem(THEME_KEY)
    theme = asked === 'dark' || asked === 'light' ? asked : saved || 'system'
  } catch {
    // Storage can be blocked. The system's choice is the safe default.
  }
  var dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (dark) document.documentElement.classList.add('dark')
})()
