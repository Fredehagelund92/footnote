import { readFileSync } from 'node:fs'

/*
  The size of a picture of the docs (docs/help/README.md, "Pictures"), read from its file, so the
  app's Docs area and the docs site draw it at its size before it loads. A screen is taken at twice
  the pixels, so it is drawn at most half as wide as its file, never larger than the screen was.
*/

/** A picture's size in pixels: a WebP's from its header, an SVG's from its viewBox. */
export function pictureSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path)
  if (path.endsWith('.svg')) {
    const box = /viewBox="\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(
      bytes.toString('utf8'),
    )
    if (!box) throw new Error(`${path} has no viewBox`)
    return { width: Number(box[1]), height: Number(box[2]) }
  }
  const kind = bytes.toString('latin1', 12, 16)
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP')
    throw new Error(`${path} is not a WebP file`)
  if (kind === 'VP8X')
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
  if (kind === 'VP8 ')
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  if (kind === 'VP8L') {
    const bits = bytes.readUInt32LE(21)
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) }
  }
  throw new Error(`${path}: a WebP file of a kind the docs do not know, ${kind}`)
}

/** How wide a picture is drawn at most: a screen at half its pixels, a diagram as wide as its page. */
export const drawnWidth = (path: string, width: number) =>
  path.endsWith('.webp') ? Math.round(width / 2) : undefined
