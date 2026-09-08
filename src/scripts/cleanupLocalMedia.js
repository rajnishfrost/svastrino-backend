import '../config/env.js'
import { existsSync, readdirSync, statSync, unlinkSync, rmdirSync } from 'node:fs'
import path from 'node:path'
import { UPLOADS_ROOT } from '../config/uploads.js'

/**
 * Remove local copies of media that the CDN is already serving.
 *
 * Runs AFTER migrateLocalMedia.js. A file under server/uploads is deleted only
 * when the object with the same key answers HTTP 200 on the CDN with the same
 * byte length — "it is on S3" is checked, never assumed. Anything else stays,
 * and is listed so a person can decide: a file the CDN does not have, or has
 * at a different size, might be the only copy.
 *
 * Dry run by default. --apply deletes. --orphans also deletes files that the
 * CDN does not have AND no database row references (the report from
 * migrateLocalMedia.js --report says what is referenced); without that flag
 * orphans are only listed.
 *
 *   CDN_URL=https://<cdn> node src/scripts/cleanupLocalMedia.js [--report <migrate-report.json>] [--apply] [--orphans]
 */
const apply = process.argv.includes('--apply')
const killOrphans = process.argv.includes('--orphans')
const ri = process.argv.indexOf('--report')
const referenced = new Set()
if (ri !== -1) {
  const { readFileSync } = await import('node:fs')
  for (const p of JSON.parse(readFileSync(process.argv[ri + 1], 'utf8')).plan) referenced.add(p.key)
}
const CDN = (process.env.CDN_URL || '').replace(/\/$/, '')
if (!CDN) { console.error('CDN_URL chahiye'); process.exit(1) }

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* files(p)
    else if (e.isFile() && !e.name.startsWith('.')) yield p
  }
}
async function head(key) {
  try { const r = await fetch(`${CDN}/${key}`, { method: 'HEAD', signal: AbortSignal.timeout(15000) }); return { status: r.status, length: Number(r.headers.get('content-length') || 0) } }
  catch { return { status: 0, length: 0 } }
}

let onCdn = 0, orphan = 0, keep = 0, bytesFreed = 0
const keepList = []
for (const file of files(UPLOADS_ROOT)) {
  const key = path.relative(UPLOADS_ROOT, file).split(path.sep).join('/')
  const size = statSync(file).size
  const cdn = await head(key)
  const same = cdn.status === 200 && cdn.length === size
  const isRef = referenced.has(key)
  if (same) {
    onCdn++; bytesFreed += size
    if (apply) unlinkSync(file); else console.log(`  would delete (on CDN, same size) ${key}`)
  } else if (!isRef && ri !== -1) {
    orphan++
    if (apply && killOrphans) { unlinkSync(file); bytesFreed += size }
    else console.log(`  orphan (no DB ref, CDN ${cdn.status}) ${key}  ${size} b${killOrphans ? '' : '  — kept; add --orphans to delete'}`)
  } else {
    keep++; keepList.push(`${key}  (CDN ${cdn.status}${cdn.status === 200 ? `, size ${cdn.length} vs local ${size}` : ''}${isRef ? ', referenced' : ''})`)
  }
}
// Empty folders left behind are noise, not data. Deepest first, so a parent
// that only held now-empty children goes too; the root itself stays.
function prune(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) prune(path.join(dir, e.name))
  if (dir !== UPLOADS_ROOT && readdirSync(dir).length === 0) rmdirSync(dir)
}
if (apply) prune(UPLOADS_ROOT)
console.log(`\n  on CDN (deleted${apply ? '' : ' if --apply'}): ${onCdn}  · orphans: ${orphan}  · kept: ${keep}  · ${(bytesFreed / 1e6).toFixed(1)} MB${apply ? ' freed' : ' would be freed'}`)
for (const k of keepList) console.log(`  KEPT ${k}`)
console.log(apply ? '✓ done' : 'DRY RUN — nothing deleted.')
