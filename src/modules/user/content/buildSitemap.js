// Write client/public/sitemap.xml and robots.txt from what is actually in the
// database.
//   npm run build:sitemap
//
// Generated rather than hand-kept because the list is 280-odd URLs and drifts
// every time an article or a career page is added. A stale sitemap is worse
// than none: it points a crawler at addresses that no longer answer.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectDB } from '../../../config/db.js'
import { Blog } from '../blogs/blog.model.js'
import { Course } from './course.model.js'
import { MentoringProgram } from './program.model.js'
import { SitePage } from './sitePage.model.js'

const here = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(here, '..', '..', '..', '..', '..', 'client', 'public')

const ORIGIN = process.env.SITE_ORIGIN || 'https://svastrino.com'

/**
 * Pages whose address is fixed. `changefreq` and `priority` are hints only —
 * search engines have long said they largely ignore them — so they are kept
 * plain rather than tuned.
 */
const STATIC_PATHS = [
  '/',
  '/services',
  '/services/compare',
  '/skill-build/nirmaan',
  '/skill-build/psychometric-testing',
  '/book-online',
  '/resources',
  '/resources/career-library',
  '/resources/faqs',
  '/resources/success-stories',
  '/blog',
  '/about',
  '/our-ideology',
  '/contact',
  '/offers',
]

// Anything behind a login, or that only makes sense to one person, is left out:
// a crawler cannot reach it and listing it only wastes crawl budget.
const EXCLUDED = ['/dashboard', '/settings', '/downloads', '/support', '/checkout', '/learn', '/admin', '/organisation']

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))

const entry = (path, lastmod) =>
  `  <url>\n    <loc>${esc(ORIGIN + path)}</loc>` +
  (lastmod ? `\n    <lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : '') +
  '\n  </url>'

async function run() {
  await connectDB()

  const urls = STATIC_PATHS.map((p) => entry(p))

  // Articles and career pages keep the root-level addresses the WordPress site
  // ranked for, so that is what goes in the sitemap — not the /blog/ form.
  const posts = await Blog.find({ published: true }).select('slug updatedAt publishedAt').lean()
  for (const p of posts) urls.push(entry(`/${p.slug}`, p.updatedAt || p.publishedAt))

  const courses = await Course.find({ active: true }).select('slug updatedAt').lean()
  for (const c of courses) urls.push(entry(`/${c.slug}`, c.updatedAt))

  const programs = await MentoringProgram.find({ active: true }).select('slug updatedAt').lean()
  for (const p of programs) urls.push(entry(`/services/${p.slug}`, p.updatedAt))

  const pages = await SitePage.find({ active: true }).select('slug updatedAt').lean()
  for (const p of pages) urls.push(entry(`/legal/${p.slug}`, p.updatedAt))

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join('\n') +
    '\n</urlset>\n'

  mkdirSync(PUBLIC_DIR, { recursive: true })
  writeFileSync(join(PUBLIC_DIR, 'sitemap.xml'), xml)

  const robots =
    'User-agent: *\n' +
    'Allow: /\n' +
    EXCLUDED.map((p) => `Disallow: ${p}`).join('\n') +
    `\n\nSitemap: ${ORIGIN}/sitemap.xml\n`
  writeFileSync(join(PUBLIC_DIR, 'robots.txt'), robots)

  console.log(`✓ sitemap.xml — ${urls.length} URLs`)
  console.log(`    ${STATIC_PATHS.length} fixed pages · ${posts.length} articles · ${courses.length} career pages · ${programs.length} programmes · ${pages.length} policies`)
  console.log('✓ robots.txt')
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Sitemap failed:', err.message)
  process.exit(1)
})
