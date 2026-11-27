# The Footnote logo

Footnote is the product's name. The captain chose it on 18 November 2026, and the
[product name page](../product-name.md) says where the name appears. The owner chose this logo on
19 November 2026, from the second round of drawn options.

## The mark

The **symbol** is a chunky asterisk, the sign that sends a reader to a footnote, with one arm come
loose as a dot. On a 48 unit grid (`viewBox="0 0 48 48"`) it is four round-capped strokes, 10 wide,
from the centre (24, 24) to (24, 10), (37.3, 19.7), (15.8, 35.3) and (10.7, 19.7), and a dot of
radius 4.5 at (32.8, 36.1).

The **wordmark** is `footnote` in lowercase, **Outfit** weight 600, line height 1. It was set with
the kerning of the OFL font file and outlined, so no webfont loads and the logo never falls back to
another typeface.

The **lockup** is the symbol, then the wordmark centred on the symbol's height. It comes in two
proportions, both from the owner's mockup:

| Lockup  | Symbol | Gap | Wordmark             | `viewBox`     | Used                                      |
| ------- | ------ | --- | -------------------- | ------------- | ----------------------------------------- |
| App     | 26     | 9   | 24, tracked -0.03em  | `0 0 125 26`  | Everywhere in the app and the public site |
| Display | 104    | 22  | 76, tracked -0.035em | `0 0 408 104` | The README and the social preview         |

The **tile** is the symbol in white at 40 of 64 on #111111, with corners of 16 of 64. An accent
tile, the symbol in #A3470E on white with a 1 pixel #E6E6E6 border, is drawn in the mockup for
uses outside the product; the app never shows it (see Usage).

## Where it shows

| Place                        | What                    | Size                                                                                                                        |
| ---------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Sidebar, expanded            | The lockup, link home   | 20 high, in the 48 pixel header row, centred on the breadcrumb's line above the hairline the row shares with the app header |
| Sidebar, folded to the rail  | The symbol              | 20 by 20, in the same place. Clicking it expands the sidebar                                                                |
| Phone menu sheet             | The lockup              | The same 20 high, in the sheet's 56 pixel header, on a 44 pixel target. The phone header itself shows no logo               |
| Sign-in, consent, signed out | The lockup              | 32 high (about 154 wide), on the content column, 24 above the heading                                                       |
| The app's Docs               | The lockup              | 20 high, then a hairline and "Docs"                                                                                         |
| The public site's header     | The symbol and the name | The symbol 20 high and the name in Inter; in the docs, then a hairline and "Docs" (`site/shared/Brand.astro`)               |
| Favicon and touch icon       | The tile                | Below                                                                                                                       |
| Web app manifest             | The tile                | 192 and 512, and a 512 full square for masking                                                                              |
| README on GitHub             | The display lockup      | 56 high, the light or the dark file by the reader's colour scheme (`docs/images`)                                           |
| Social preview               | Display lockup, tagline | 1280 by 640, set in the repository settings and the public site's `og:image`; the lockup 130 high, the tagline under it     |
| Owner avatar                 | The tile, a full square | 500, the symbol 312 of 500                                                                                                  |

The link home is named "Footnote". In the sidebar the symbol and the lockup are decorative SVGs
inside it; on its own, `Logo` is one image named "Footnote".

## Files

| File                                                                 | Use                                                                                                      |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `components/footnote/logo.tsx`                                       | `LogoSymbol` and `Logo` (the app lockup) in the app, each a `<use>` of a public file below               |
| `public/footnote-symbol.svg`                                         | The symbol on its own, in currentColor, for docs and slides                                              |
| `public/footnote-lockup.svg`                                         | The app lockup, outlined, in currentColor                                                                |
| `public/favicon.svg`                                                 | The tile on 32 units (corners 8, symbol 24), in every scheme                                             |
| `public/favicon.ico`                                                 | 16 (the symbol 13 of 16), 32 and 48, from `favicon.svg`, for browsers without SVG icons                  |
| `public/apple-touch-icon.png`                                        | 180, the tile as a full square (the home screen rounds it)                                               |
| `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`       | The manifest's icons: the tile with its corners, and a full square for masking                           |
| `/site.webmanifest`                                                  | Written by the build (`webManifest` in `vite.config.ts`), so a renamed build names itself                |
| `docs/images/footnote-lockup-light.svg`, `footnote-symbol-light.svg` | The display lockup and the symbol in #111111, for GitHub's light pages                                   |
| `docs/images/footnote-lockup-dark.svg`, `footnote-symbol-dark.svg`   | The display lockup and the symbol in #FFFFFF, for GitHub's dark pages                                    |
| `docs/images/footnote-social-preview.png`                            | 1280 by 640, the display lockup in #FFFFFF and the tagline in Nunito Sans 400 at 44, #A3A3A3, on #111111 |
| `docs/images/footnote-avatar.png`                                    | 500, the tile as a full square, for the owner's avatar                                                   |

GitHub shows a README image as an `<img>`, where `currentColor` is black on any page, so the README
uses the fixed-colour files in a `<picture>` with a `prefers-color-scheme: dark` source.

The public files are in `src/web/public`. The app draws `footnote-lockup.svg` and
`footnote-symbol.svg` by reference (`<use href="/footnote-lockup.svg#mark">`), so their drawing
never weighs on the app's first load. A change of the mark keeps three things: the element
`id="mark"`, drawn in `currentColor` (no colour of its own), the `viewBox` the component gives
(`0 0 125 26` for the lockup, `0 0 48 48` for the symbol; change the component with it otherwise),
and the file names. The ICO and the PNGs are rendered from the same drawing; no test checks yet
that they match. The social preview and the avatar are set in GitHub's settings by hand, so they
change there only when a maintainer uploads the new files.

## The favicon and the touch icon

Both are the tile, #111111 with the white symbol, in every colour scheme. A bare mark switched by
`prefers-color-scheme` disappears when the browser's tab strip is dark and the system is light, or
the other way round; the tile shows on any tab strip. The favicon holds the symbol larger than
the app tile, 24 of 32, and the ICO's 16 pixel image 13 of 16, so at 16 pixels the dot still stands
apart from the arms. The touch icon and the manifest's icons keep the app tile's 40 of 64.

The links in `index.html` carry a version (`?v=3`). Raise it whenever an icon changes, so browsers
drop the cached old one.

## Usage

- **Colour.** One colour: the ink of the text around it (`currentColor`; in the app the foreground
  token, #13161d light and #f4f5f8 dark). Fixed files use #111111 on light and #FFFFFF on dark.
  Forced colours paint it as CanvasText. **Never the accent in the app**: Footnote blue is for what
  the product does (contract 6.1), not for its name, and the #A3470E accent tile stays outside the
  product.
- **Clear space.** Half the lockup's height on every side: 10 pixels around the 20 pixel lockup.
- **Minimum size.** The lockup 16 high, the symbol 12. Below 16 use the symbol alone.
- **Do** size it by height and let the width follow, and use the symbol alone where space is
  square.
- **Do not** put it on a tile or behind a colour in the app (the tile is for the favicon, the
  touch icon, the manifest and the avatar only), outline it, add a gradient or shadow, animate,
  rotate or stretch it, re-space it, or set the name in another typeface.
