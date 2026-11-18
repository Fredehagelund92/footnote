# The Footnote logo

Footnote is the product's name. The captain chose it on 18 November 2026, and the
[product name page](../product-name.md) says where the name appears.

**The final mark is pending.** The owner is having logo options drawn separately. Until one is
chosen, the logo is a placeholder: the name set in type, with no drawn symbol. When the final
mark arrives, it replaces the paths of the files below, which keep their names for that: the app
shows them by reference, so the files alone change it.

## The placeholder wordmark

The wordmark is `Footnote` in **Newsreader italic**, weight 400 at optical size 18, tracked
-0.01em: the serif the landing page sets the name in. It was shaped with kerning from the OFL font
file and outlined, so no webfont loads and the logo never falls back to another typeface.

Where a square mark is needed (the sidebar's rail, the favicon, the touch icon and the avatar),
the placeholder is the wordmark's own italic F: a letter of the name, not a drawn symbol.

| Measure  | At the sidebar's 20 pixels                                                               |
| -------- | ---------------------------------------------------------------------------------------- |
| Lockup   | The wordmark alone, 60 by 20 (`viewBox="0 0 120 40"`), on a grid of 2 units to the pixel |
| Wordmark | Cap height 13 (26 units), baseline at 33 units, so the capitals are centred              |
| F        | 18 by 20 (`viewBox="0 0 36 40"`), cap height 15 (30 units), centred                      |

## Where it shows

| Place                        | What                    | Size                                                                                                                        |
| ---------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Sidebar, expanded            | The wordmark, link home | 20 high, in the 48 pixel header row, centred on the breadcrumb's line above the hairline the row shares with the app header |
| Sidebar, folded to the rail  | The F                   | 18 by 20, in the same place. Clicking it expands the sidebar                                                                |
| Phone menu sheet             | The wordmark            | The same 20 high, in the sheet's 56 pixel header, on a 44 pixel target. The phone header itself shows no logo               |
| Sign-in, consent, signed out | The wordmark            | 32 high (about 96 wide), on the content column, 24 above the heading                                                        |
| Favicon and touch icon       | The F on a tile         | Below                                                                                                                       |
| README on GitHub             | The wordmark            | 56 high, the light or the dark file by the reader's colour scheme (`docs/images`)                                           |
| Social preview               | The wordmark, tagline   | 1280 by 640, set in the repository settings; the wordmark 120 high, the tagline under it                                    |
| Owner avatar                 | The F on a tile         | 500, the F's grid 310 high in #f4f5f8 on #13161d, like the touch icon                                                       |

The link home is named "Footnote". In the sidebar the F and the wordmark are decorative SVGs inside
it; on its own, `Logo` is one image named "Footnote".

## Files

The files keep their names and their sizes, so the final mark can replace them one for one.

| File                                                                 | Use                                                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `components/footnote/logo.tsx`                                       | `LogoSymbol` (the F) and `Logo` (the wordmark) in the app, each a `<use>` of a public file below   |
| `public/footnote-symbol.svg`                                         | The F on its own, in currentColor, for docs and slides                                             |
| `public/footnote-lockup.svg`                                         | The wordmark, outlined, in currentColor                                                            |
| `public/favicon.svg`                                                 | The F's grid 22 of 32 high in #f4f5f8 on a #13161d tile with 7 unit corners, in every scheme       |
| `public/favicon.ico`                                                 | 16, 32 and 48, rendered from `favicon.svg`, for browsers without SVG icons                         |
| `public/apple-touch-icon.png`                                        | 180, the F's grid 112 high in #f4f5f8 on #13161d, for home screens                                 |
| `docs/images/footnote-lockup-light.svg`, `footnote-symbol-light.svg` | The wordmark and the F in #13161d, for GitHub's light pages                                        |
| `docs/images/footnote-lockup-dark.svg`, `footnote-symbol-dark.svg`   | The wordmark and the F in #f4f5f8, for GitHub's dark pages                                         |
| `docs/images/footnote-social-preview.png`                            | 1280 by 640, the wordmark in #f4f5f8 and the tagline in Nunito Sans 400 at 44, #a1a4ac, on #13161d |
| `docs/images/footnote-avatar.png`                                    | 500, the F on the ink tile, for the owner's avatar                                                 |

GitHub shows a README image as an `<img>`, where `currentColor` is black on any page, so the README
uses the fixed-colour files in a `<picture>` with a `prefers-color-scheme: dark` source; they are
the public files with only the fill changed.

The public files are in `src/web/public`. The app draws `footnote-lockup.svg` and `footnote-symbol.svg`
by reference (`<use href="/footnote-lockup.svg#mark">`), so their drawing never weighs on the app's
first load, and a new mark only has to keep three things: the element `id="mark"`, drawn in
`currentColor` (no fill of its own), the `viewBox` the component gives (`0 0 120 40` for the
lockup, `0 0 36 40` for the symbol; change the component with it otherwise), and the file names.
The ICO, the touch icon and the PNGs are rendered from the same drawing. No test checks yet that
they match. The social
preview and the avatar are set in GitHub's settings by hand, so they change there only when a
maintainer uploads the new files.

## The favicon and the touch icon

Both are the F in #f4f5f8 on an ink (#13161d) tile, in every colour scheme. A bare mark switched
by `prefers-color-scheme` disappears when the browser's tab strip is dark and the system is light,
or the other way round; the tile shows on any tab strip. The favicon's tile is the whole 32 unit
square with corners of 7 (about 22 percent), and the F's 36 by 40 grid is 22 units high, centred.
The touch icon is a full square, since the home screen rounds it, with the grid 112 of 180 high.

The links in `index.html` carry a version (`?v=2`). Raise it whenever an icon changes, so browsers
drop the cached old one.

## Usage

- **Colour.** One colour: the ink of the text around it (`currentColor`; in the app the foreground
  token, #13161d light and #f4f5f8 dark). Forced colours paint it as CanvasText. **Never the
  accent**: Footnote blue is for what the product does (contract 6.1), not for its name.
- **Clear space.** Half the wordmark's height on every side: 10 pixels around the 20 pixel
  wordmark.
- **Minimum size.** The wordmark 16 high, the F 12 high. Below 16 use the F alone.
- **Do** size it by height and let the width follow, and use the F alone where space is square.
- **Do not** put it on a tile or behind a colour in the app (the tile is for the favicon, the
  touch icon and the avatar only), outline it, add a gradient or shadow, animate, rotate or
  stretch it, re-space it, or set the name in another typeface.
