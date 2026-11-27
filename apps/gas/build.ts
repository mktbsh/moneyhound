/**
 * Assemble the Apps Script project in apps/gas/dist:
 * Code.js, appsscript.json, and the single-file page from apps/web/dist.
 * Run `bun run gas:build`. Pushing and deploying is the owner's step (clasp).
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const here = import.meta.dirname
const dist = join(here, 'dist')
const page = join(here, '..', 'web', 'dist', 'index.html')

if (!existsSync(page)) {
  console.error('apps/web/dist/index.html がありません。先に bun run build を実行してください。')
  process.exit(1)
}
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
copyFileSync(join(here, 'src', 'Code.js'), join(dist, 'Code.js'))
copyFileSync(join(here, 'appsscript.json'), join(dist, 'appsscript.json'))
copyFileSync(page, join(dist, 'index.html'))
console.log('apps/gas/dist に Code.js / appsscript.json / index.html を用意しました。')
