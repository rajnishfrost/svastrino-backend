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

// How many items a list shows per page. Must match PER_PAGE in the client's
// Blog.jsx and Resources.jsx — too low and the sitemap lists pages that come
// back empty, too high and the last few articles are never linked at all.
const PER_PAGE = 12

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
  //
  // An article's lastmod is the day it was published, not `updatedAt`.
  // `updatedAt` is when the record was last written, which is a different thing:
  // a bulk write during the move off WordPress stamped 217 of the 219 articles
  // with the same date, so this file was telling Google that every article on
  // the site changed on one day in August. lastmod that is identical everywhere
  // describes nothing, and Google's own guidance is that it then stops reading
  // the field — throwing away the 191 genuinely different publication dates
  // underneath it.
  //
  // The trade is that an article edited in the panel from now on will not move
  // its lastmod. Worth it: nothing is edited often here, and a date that is
  // occasionally stale is better than a date that is uniformly wrong. Give the
  // model a timestamp for content edits if that changes.
  const posts = await Blog.find({ published: true }).select('slug updatedAt publishedAt').lean()
  for (const p of posts) urls.push(entry(`/${p.slug}`, p.publishedAt))

  // Career pages keep `updatedAt`. They have no publication date of their own,
  // and the one date all 52 share is true — they were all rewritten the day the
  // career library became a single document. A date being the same everywhere
  // is only a problem when it is the same for no reason.
  const courses = await Course.find({ active: true }).select('slug updatedAt').lean()
  for (const c of courses) urls.push(entry(`/${c.slug}`, c.updatedAt))

  const programs = await MentoringProgram.find({ active: true }).select('slug updatedAt').lean()
  for (const p of programs) urls.push(entry(`/services/${p.slug}`, p.updatedAt))

  const pages = await SitePage.find({ active: true }).select('slug updatedAt').lean()
  for (const p of pages) urls.push(entry(`/legal/${p.slug}`, p.updatedAt))

  // The rest of each list.
  //
  // /blog shows twelve articles and the career library twelve careers, so
  // without these the only articles with a link pointing at them anywhere on
  // the site were the twelve on page one — and Google, which had found the
  // other 207 here in the sitemap but nowhere else, left them in "discovered,
  // currently not indexed" for months.
  //
  // Listed as well as linked because this is also what the prerenderer builds
  // its file list from: an address absent here gets no HTML of its own.
  // Page one is /blog itself, so the count starts at two.
  //
  // Every listing page carries the newest date in its list, because a new
  // article changes all of them at once: it goes on page one and pushes the
  // last article of every page onto the next. These are the pages a crawler
  // walks to reach the other 207, so they are the ones worth telling it are
  // fresh.
  const newest = (rows, key) =>
    rows.reduce((latest, r) => (r[key] && (!latest || r[key] > latest) ? r[key] : latest), null)
  const pagesOf = (count) => Math.ceil(count / PER_PAGE)
  const newestPost = newest(posts, 'publishedAt')
  const newestCourse = newest(courses, 'updatedAt')
  for (let n = 2; n <= pagesOf(posts.length); n += 1) urls.push(entry(`/blog/page/${n}`, newestPost))
  for (let n = 2; n <= pagesOf(courses.length); n += 1) urls.push(entry(`/resources/career-library/page/${n}`, newestCourse))

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
  console.log(`    ${STATIC_PATHS.length} fixed pages · ${posts.length} articles · ${courses.length} career pages · ${programs.length} programs · ${pages.length} policies`)
  console.log(`    ${pagesOf(posts.length) - 1} blog listing pages · ${pagesOf(courses.length) - 1} career library listing pages`)
  console.log('✓ robots.txt')
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Sitemap failed:', err.message)
  process.exit(1)
})
