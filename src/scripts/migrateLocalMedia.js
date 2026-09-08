import '../config/env.js'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import { connectDB } from '../config/db.js'
import { putFile, publicUrl, contentTypeFor } from '../config/s3.js'
import { UPLOADS_ROOT as UPLOADS_DIR } from '../config/uploads.js'

/**
 * Move media that only exists on THIS machine's disk up to S3, and point the
 * database at it.
 *
 * Why this exists: a local server (STORAGE=local) pointed at the shared
 * production database writes '/uploads/<key>' paths into production data —
 * paths that name a file on a laptop. Production has no such file, and the
 * site answers '/uploads/*' with the SPA's index.html, so the browser gets an
 * HTML page where it expected a caption or a photo. This script finds every
 * such value, uploads the file it names, and rewrites the value to the CDN URL
 * the same file would have carried had it been uploaded in production.
 *
 * It scans EVERY collection, walking arrays and nested objects, so a field
 * added later is swept too. It uploads through the app's own putFile, so the
 * object gets the same ContentType the admin panel would have given it.
 * A key that already exists on the CDN with the same byte length is not
 * re-uploaded, only re-pointed.
 *
 * Dry run by default — prints every upload and every rewrite, touches nothing.
 * Add --apply to do it. Needs the production storage env alongside the DB one:
 *
 *   AWS_PROFILE=<profile with s3:PutObject> STORAGE=s3 S3_BUCKET=<bucket> \
 *   AWS_REGION=<region> CDN_URL=https://<cdn> node --env-file=.env.local \
 *   src/scripts/migrateLocalMedia.js [--apply] [--report <path>]
 */

const apply = process.argv.includes('--apply')
const ri = process.argv.indexOf('--report')
const reportPath = ri !== -1 ? process.argv[ri + 1] : null

for (const v of ['S3_BUCKET', 'AWS_REGION', 'CDN_URL']) {
  if (!process.env[v]) { console.error(`${v} set nahi hai — bina iske upload/URL ban hi nahi sakta`); process.exit(1) }
}
const CDN = process.env.CDN_URL.replace(/\/$/, '')

/** Every string in a document that names something under /uploads/. */
function* walk(value, trail = '') {
  if (typeof value === 'string') { if (/^\/uploads\/.+/.test(value)) yield { path: trail, value }; return }
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) yield* walk(value[i], `${trail}[${i}]`); return }
  if (value && typeof value === 'object' && !(value instanceof mongoose.Types.ObjectId) && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) yield* walk(v, trail ? `${trail}.${k}` : k)
  }
}

async function headCdn(key) {
  try {
    const r = await fetch(`${CDN}/${key}`, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
    return { status: r.status, length: Number(r.headers.get('content-length') || 0) }
  } catch { return { status: 0, length: 0 } }
}

async function main() {
  await connectDB()
  const db = mongoose.connection.db
  const collections = (await db.listCollections().toArray()).map((c) => c.name).sort()

  // 1. Every reference, grouped by key.
  const refs = new Map() // key -> [{ collection, id, path, value }]
  for (const name of collections) {
    for await (const doc of db.collection(name).find({})) {
      for (const hit of walk(doc)) {
        const key = hit.value.replace(/^\/uploads\//, '').split(/[?#]/)[0]
        if (!refs.has(key)) refs.set(key, [])
        refs.get(key).push({ collection: name, id: doc._id, path: hit.path, value: hit.value })
      }
    }
  }
  console.log(`references: ${[...refs.values()].reduce((n, a) => n + a.length, 0)} across ${refs.size} distinct keys, ${collections.length} collections scanned`)

  // 2. Classify each key.
  const plan = []
  for (const [key, where] of refs) {
    const local = path.join(UPLOADS_DIR, key)
    const onDisk = existsSync(local) ? statSync(local).size : null
    const cdn = await headCdn(key)
    const state = cdn.status === 200 && (onDisk == null || cdn.length === onDisk) ? 'on-cdn'
      : cdn.status === 200 ? 'on-cdn-size-mismatch'
      : onDisk != null ? 'local-only'
      : 'missing-everywhere'
    plan.push({ key, state, onDisk, cdn, where })
  }
  const by = (s) => plan.filter((p) => p.state === s)
  console.log(`  local-only (upload + rewrite): ${by('local-only').length}`)
  console.log(`  on-cdn already (rewrite only):  ${by('on-cdn').length}`)
  console.log(`  on-cdn but different size:      ${by('on-cdn-size-mismatch').length}  (left alone — look at these)`)
  console.log(`  missing everywhere:             ${by('missing-everywhere').length}  (nothing to upload — the file is gone)`)
  for (const p of by('missing-everywhere')) console.log(`      MISSING ${p.key}  <- ${p.where.map((w) => `${w.collection}.${w.path}`).join(', ')}`)
  for (const p of by('on-cdn-size-mismatch')) console.log(`      MISMATCH ${p.key} local=${p.onDisk} cdn=${p.cdn.length}`)

  // 3. Do it (or say what would be done).
  let uploaded = 0, rewritten = 0, failed = 0
  const touched = []
  for (const p of plan) {
    if (p.state === 'local-only') {
      if (!apply) { console.log(`  would upload  ${p.key}  (${p.onDisk} b, ${contentTypeFor(p.key)})`) }
      else {
        try {
          await putFile(path.join(UPLOADS_DIR, p.key), p.key, contentTypeFor(p.key))
          const check = await headCdn(p.key)
          if (check.status !== 200 || check.length !== p.onDisk) throw new Error(`verify failed: HEAD ${check.status}, ${check.length} b vs ${p.onDisk} b local`)
          uploaded++
          console.log(`  uploaded ✓    ${p.key}`)
        } catch (e) { failed++; console.log(`  UPLOAD FAILED ${p.key}: ${e.message}`); continue }
      }
    }
    if (p.state !== 'local-only' && p.state !== 'on-cdn') continue
    // The value production would have stored itself.
    const to = publicUrl(p.key)
    for (const w of p.where) {
      if (!apply) { console.log(`  would rewrite ${w.collection}.${w.path} (${w.id})  ${w.value} -> ${to}`); continue }
      // Arrays are addressed by index in the path, exactly as walked, so a
      // caption at captions[2].url is set as 'captions.2.url'.
      const field = w.path.replace(/\[(\d+)\]/g, '.$1')
      const r = await db.collection(w.collection).updateOne({ _id: w.id, [field]: w.value }, { $set: { [field]: to } })
      if (r.modifiedCount === 1) { rewritten++; touched.push({ ...w, to }) }
      else console.log(`  REWRITE SKIPPED ${w.collection}.${field} (${w.id}) — value changed under us`)
    }
  }

  if (reportPath) writeFileSync(reportPath, JSON.stringify({ apply, plan: plan.map(({ key, state, onDisk, cdn, where }) => ({ key, state, onDisk, cdnStatus: cdn.status, cdnLength: cdn.length, refs: where.map((w) => ({ collection: w.collection, id: String(w.id), path: w.path, value: w.value })) })), touched: touched.map((t) => ({ ...t, id: String(t.id) })) }, null, 2))
  console.log(apply ? `\n✓ uploaded ${uploaded}, rewrote ${rewritten} reference(s), ${failed} failed` : '\nDRY RUN — nothing uploaded, nothing rewritten. Re-run with --apply.')
  await mongoose.disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
