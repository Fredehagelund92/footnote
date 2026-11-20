import { readFileSync } from 'node:fs'

/*
  Refuses npm ci and npm install on a Node older than package.json's engines, and says what to do
  (package.json "preinstall"). npm's own engine-strict refusal names the versions but not the way
  out, and a worker started with --permission is denied the network only from Node 26 on
  (docs/contributing/connector-security.md), so an older Node must not get a working install.

  It runs on whatever Node the person has, so it is plain JavaScript and uses nothing newer than
  Node 14. npm runs it once the packages are in place, so an older Node waits for them first.
*/

const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const major = Number(engines.node.replace(/^>=\s*/, '').split('.')[0])
const current = process.versions.node

if (Number(current.split('.')[0]) < major) {
  console.error(
    [
      '',
      `Footnote needs Node ${major} or later, and this is Node ${current}.`,
      `Install Node ${major}, the version in .nvmrc, then run npm ci again.`,
      'With nvm, run these in this folder: nvm install, then nvm use.',
      '',
    ].join('\n'),
  )
  process.exit(1)
}
