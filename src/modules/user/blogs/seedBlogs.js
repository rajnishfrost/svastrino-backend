// Seeds the blog archive (migrated from the legacy svastrino.com WordPress site)
// into MongoDB. Idempotent — upserts by slug. Run:  npm run seed:blogs
import '../../../config/env.js'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { localMedia, mediaManifestSize } from '../../../utils/media.js'
import { Blog } from './blog.model.js'

const here = dirname(fileURLToPath(import.meta.url))
const DATA_FILE = join(here, 'data', 'blogs.json')

/** Rough reading time — 200 words/min, floored at 1. */
const readingMins = (body) => Math.max(1, Math.round(body.trim().split(/\s+/).length / 200))

/**
 * Card excerpt, derived from the article itself.
 *
 * The scraped `excerpt` field is unreliable — for most posts it's a truncated
 * summary of the page rather than the real opening line — so we take the first
 * real paragraph of the body instead and fall back to the scraped value only if
 * the body yields nothing.
 */
function buildExcerpt(body, fallback = '', max = 165) {
  const firstPara = (body || '')
    .split(/\n\s*\n/)
    // Skip headings, blockquotes, lists and rules to reach actual prose.
    .find((block) => {
      const t = block.trim()
      return t && !/^(#{1,6}\s|>|[-*]\s|\d+\.\s|---+$)/.test(t)
    })

  const plain = (firstPara || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')      // bold
    .replace(/[*_]([^*_]+)[*_]/g, '$1')     // italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → label
    .replace(/\s+/g, ' ')
    .trim()

  if (!plain) return fallback
  if (plain.length <= max) return plain

  const cut = plain.slice(0, max)
  return `${cut.slice(0, cut.lastIndexOf(' ')).trim()}…`
}

async function run() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`✗ Seed data not found at ${DATA_FILE}`)
    process.exit(1)
  }

  const posts = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  await connectDB()

  let created = 0
  let updated = 0

  for (const p of posts) {
    const doc = {
      slug: p.slug,
      title: p.title,
      owner: 'svastrino',
      author: p.author || 'Svastrino',
      categories: p.categories || [],
      excerpt: buildExcerpt(p.body, p.excerpt),
      body: p.body || '',
      coverImage: localMedia(p.coverImage || ''),
      sourceUrl: p.sourceUrl || '',
      publishedAt: p.publishedAt ? new Date(p.publishedAt) : new Date(),
      readingMins: readingMins(p.body || ''),
      published: true,
      order: p.order || 0,
    }

    const res = await Blog.updateOne({ slug: doc.slug }, { $set: doc }, { upsert: true })
    if (res.upsertedCount) created++
    else updated++
  }

  // A post dropped from the source file must leave the site too. Without this
  // the seed only ever adds, so a duplicate or a retracted article stays on
  // /blog for good — which is how a second copy of "Creative Writing" survived
  // being removed from the data.
  const keep = posts.map((p) => p.slug)
  const dropped = await Blog.deleteMany({ slug: { $nin: keep } })
  if (dropped.deletedCount) {
    console.log(`  ⏻ Removed ${dropped.deletedCount} post(s) no longer in the source file`)
  }

  const total = await Blog.countDocuments()
  const cats = await Blog.distinct('categories')

  const local = await Blog.countDocuments({ coverImage: /^\/uploads\// })
  console.log(`✓ Blogs seeded — ${created} created, ${updated} updated (${total} total in DB)`)
  console.log(`  categories: ${cats.sort().join(', ')}`)
  console.log(
    mediaManifestSize()
      ? `  covers: ${local} local, ${total - local} still remote`
      : '  covers: all remote — run `npm run fetch:media` to host them locally'
  )

  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Seed failed:', err)
  process.exit(1)
})
