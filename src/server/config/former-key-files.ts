import { link, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/*
  The default key files were named after the product's former name, Heed, until it was renamed
  Footnote (docs/operations.md, "Upgrade from Heed 0.1"). A new default name alone would make a new
  key where an old one sits, which signs every agent out and voids the questions sealed in them.
  So a loader first moves the old file to the new name, once, when only the old one exists beside
  it. The move keeps the file itself, its owner-only mode included. Only a file under one of the
  default names moves, and a new file that exists always wins.
*/

/** Each default key file's name before the rename, by its name now. */
export const formerKeyFiles: ReadonlyMap<string, string> = new Map([
  ['.footnote-dev-key.pem', '.heed-dev-key.pem'],
  ['.footnote-mcp-state.key', '.heed-mcp-state.key'],
  ['.footnote-oauth-key.pem', '.heed-oauth-key.pem'],
])

const code = (error: unknown) =>
  error instanceof Error && 'code' in error ? (error as { code?: string }).code : undefined

/** Moves the key file's former default to `file` when only the former exists; says whether it did. */
export async function moveFormerKeyFile(file: string): Promise<boolean> {
  const former = formerKeyFiles.get(basename(file))
  if (!former) return false
  const from = join(dirname(file), former)
  try {
    // A hard link fails when `file` exists, so a key made meanwhile is never overwritten.
    await link(from, file)
  } catch (error) {
    if (code(error) === 'ENOENT' || code(error) === 'EEXIST') return false
    throw error
  }
  await unlink(from)
  console.warn(`Moved the key file ${from} to ${file}, its new default name.`)
  return true
}
