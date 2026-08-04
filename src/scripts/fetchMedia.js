// Downloads the media referenced by the migrated content (blog covers,
// testimonial photos, the founder portrait, brochures) so the site stops
// hot-linking svastrino.com, then writes a manifest the seeds use to rewrite
// remote URLs to local ones.
//
//   npm run fetch:media            # download + optimise, skip existing
//   npm run fetch:media -- --force # re-download everything
//
// Images are re-encoded to JPEG via `sips` (macOS built-in): the originals are
// ~950 KB 1080px PNGs but are displayed at ~370 CSS px on cards, so this cuts
// the payload by roughly an order of magnitude. Non-images (PDFs) are copied
// through untouched. If `sips` isn't available the original bytes are kept.
//
// Output: uploads/content/<year>/<month>/<file>  →  served at /uploads/content/…
// Manifest: src/data/media-manifest.json  { [remoteUrl]: "/uploads/content/…" }
import '../config/env.js'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname, basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const here = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = join(here, '..', '..')
const OUT_ROOT = join(SERVER_ROOT, 'uploads', 'content')
const MANIFEST = join(here, '..', 'data', 'media-manifest.json')

const BLOGS_JSON = join(here, '..', 'modules', 'user', 'blogs', 'data', 'blogs.json')
const SEED_CONTENT = join(here, '..', 'modules', 'user', 'content', 'seedContent.js')

/**
 * Assets referenced from the client rather than the seed data. These must be
 * listed explicitly: the client already points at the local path, so scanning
 * its source for svastrino.com URLs would no longer find them and they'd drop
 * out of the manifest on the next run.
 */
const EXTRA_ASSETS = [
  // Founder portrait — client/src/pages/user/aboutpage/About.jsx
  'https://svastrino.com/wp-content/uploads/2023/04/meet-rohit.jpg',
]

const FORCE = process.argv.includes('--force')
const CONCURRENCY = 8
const MAX_DIM = 1200        // px, longest side
const JPEG_QUALITY = 'high' // sips: low | normal | high | best

const UPLOADS_RE = /https:\/\/svastrino\.com\/wp-content\/uploads\/([^\s"'`)]+)/g

/** Every remote media URL referenced anywhere in the migrated content. */
function collectUrls() {
  const urls = new Set()

  const posts = JSON.parse(fs.readFileSync(BLOGS_JSON, 'utf8'))
  for (const p of posts) if (p.coverImage) urls.add(p.coverImage)

  // Testimonial photos and brochures live as literals in the content seed.
  if (fs.existsSync(SEED_CONTENT)) {
    const src = fs.readFileSync(SEED_CONTENT, 'utf8')
    for (const m of src.matchAll(UPLOADS_RE)) urls.add(m[0])
  }

  for (const url of EXTRA_ASSETS) urls.add(url)

  return [...urls]
}

/** https://…/wp-content/uploads/2025/12/x.png → { dir: '2025/12', name: 'x', ext: '.png' } */
function parseRemote(url) {
  const path = url.split('/wp-content/uploads/')[1]
  const dir = dirname(path)
  const file = basename(path)
  const ext = extname(file).toLowerCase()
  return { dir, name: basename(file, ext), ext }
}

const isImage = (ext) => ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)

let sipsAvailable = null
async function haveSips() {
  if (sipsAvailable !== null) return sipsAvailable
  try {
    await execFileAsync('sips', ['--version'])
    sipsAvailable = true
  } catch {
    sipsAvailable = false
  }
  return sipsAvailable
}

async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (svastrino-migration)' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Fetch one asset. Images become optimised JPEGs; anything else is stored
 * byte-for-byte. Returns { publicPath, bytesIn, bytesOut, skipped }.
 */
async function fetchOne(url) {
  const { dir, name, ext } = parseRemote(url)
  const convert = isImage(ext) && (await haveSips())
  const outExt = convert ? '.jpg' : ext
  const outDir = join(OUT_ROOT, dir)
  const outFile = join(outDir, name + outExt)
  const publicPath = `/uploads/content/${dir}/${name}${outExt}`

  if (!FORCE && fs.existsSync(outFile)) {
    const { size } = await fsp.stat(outFile)
    return { publicPath, bytesIn: 0, bytesOut: size, skipped: true }
  }

  await fsp.mkdir(outDir, { recursive: true })
  const buf = await download(url)

  if (!convert) {
    await fsp.writeFile(outFile, buf)
    return { publicPath, bytesIn: buf.length, bytesOut: buf.length, skipped: false }
  }

  // sips works on files, so stage the original next to the target then replace it.
  const tmp = join(outDir, `.tmp-${name}${ext}`)
  await fsp.writeFile(tmp, buf)
  try {
    await execFileAsync('sips', [
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', JPEG_QUALITY,
      '-Z', String(MAX_DIM),
      tmp, '--out', outFile,
    ])
  } catch {
    // Conversion failed (corrupt/unsupported) — keep the original bytes.
    await fsp.writeFile(join(outDir, name + ext), buf)
    await fsp.rm(tmp, { force: true })
    return {
      publicPath: `/uploads/content/${dir}/${name}${ext}`,
      bytesIn: buf.length, bytesOut: buf.length, skipped: false,
    }
  }
  await fsp.rm(tmp, { force: true })

  const { size } = await fsp.stat(outFile)
  return { publicPath, bytesIn: buf.length, bytesOut: size, skipped: false }
}

/** Run `worker` over `items`, at most `limit` in flight. */
async function pool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await worker(items[i], i)
      }
    })
  )
  return results
}

async function run() {
  const urls = collectUrls()
  console.log(`Found ${urls.length} remote assets referenced by the migrated content.`)
  if (await haveSips()) {
    console.log(`Optimising images → JPEG (max ${MAX_DIM}px, quality ${JPEG_QUALITY}).`)
  } else {
    console.log('! `sips` not found — storing originals without optimisation.')
  }

  let done = 0
  const failures = []

  const results = await pool(urls, CONCURRENCY, async (url) => {
    try {
      const r = await fetchOne(url)
      done++
      if (done % 25 === 0 || done === urls.length) {
        console.log(`  … ${done}/${urls.length}`)
      }
      return { url, ...r }
    } catch (err) {
      failures.push({ url, error: err.message })
      return null
    }
  })

  const ok = results.filter(Boolean)
  const manifest = Object.fromEntries(ok.map((r) => [r.url, r.publicPath]))

  await fsp.mkdir(dirname(MANIFEST), { recursive: true })
  await fsp.writeFile(MANIFEST, JSON.stringify(manifest, null, 2))

  const mb = (n) => (n / 1048576).toFixed(1)
  const downloaded = ok.filter((r) => !r.skipped)
  const bytesIn = downloaded.reduce((n, r) => n + r.bytesIn, 0)
  const bytesOut = ok.reduce((n, r) => n + r.bytesOut, 0)

  console.log(`\n✓ ${ok.length} assets ready (${downloaded.length} fetched, ${ok.length - downloaded.length} already present)`)
  if (downloaded.length) {
    console.log(`  downloaded ${mb(bytesIn)} MB → stored ${mb(bytesOut)} MB on disk`)
  }
  console.log(`  manifest → ${MANIFEST}`)

  if (failures.length) {
    console.log(`\n! ${failures.length} failed:`)
    failures.slice(0, 10).forEach((f) => console.log(`  ${f.url} — ${f.error}`))
    process.exitCode = 1
  }

  console.log('\nNext: re-run `npm run seed:blogs` and `npm run seed:content` to point the DB at the local copies.')
}

run().catch((err) => {
  console.error('✗ Media fetch failed:', err)
  process.exit(1)
})
