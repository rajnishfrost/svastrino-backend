// Write the CloudFront Function that answers moved addresses with a 301.
//   npm run build:redirects
//
// Two kinds of move end up here:
//
//   - Pages whose address changed when the site left WordPress. That list is
//     fixed and lives below, because those addresses exist nowhere else now.
//   - Articles and career pages an admin has since renamed. Those are read from
//     the database, so a rename in the panel turns into a real redirect the
//     next time this runs — no one has to remember to edit a file.
//
// A 301 is what moves a ranking across; anything softer asks a search engine to
// treat the new address as a stranger. The app also redirects these in the
// browser, but that only helps a visitor who already arrived — a crawler needs
// the status code.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectDB } from '../../../config/db.js'
import { Blog } from '../blogs/blog.model.js'
import { Course } from './course.model.js'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', '..', '..', '..', '..', 'client', 'infra', 'legacy-redirects.js')

// CloudFront rejects a function larger than this, so the file is checked rather
// than left to fail at deploy time.
const MAX_BYTES = 10 * 1024

/** Pages that moved when the site was rebuilt. Fixed — nothing generates these. */
const MOVED_PAGES = {
  '/bulls-eye': '/services/bulls-eye',
  '/bloom': '/services/bloom',
  '/breakthrough': '/services/breakthrough',
  '/our-programs': '/services',
  '/compare-programs': '/services/compare',
  '/svastrino': '/about',
  '/our-approach': '/our-ideology',
  '/contact-us': '/contact',
  '/faqs': '/resources/faqs',
  '/success-stories': '/resources/success-stories',
  '/courselist': '/resources/career-library',
  '/blogs': '/blog',
  '/sign-up': '/login?mode=signup',
  '/customer-portal': '/dashboard',
  '/newsletter': '/contact',
  '/tc-terms-of-use': '/legal/terms-of-use',
  '/privacy-policy': '/legal/privacy-policy',
  '/cancellations-and-refunds': '/legal/cancellations-and-refunds',

  // Retired. Model Session is no longer sold and the career tests were one-off
  // landing pages; both go somewhere that answers the same need rather than to
  // a 404, which would throw away whatever ranking they hold.
  '/model-session': '/services/bulls-eye',
  '/test': '/skill-build/psychometric-testing',
  '/careertest1': '/skill-build/psychometric-testing',
  '/careertest2': '/skill-build/psychometric-testing',
  '/careertest3': '/skill-build/psychometric-testing',
  '/careertest4': '/skill-build/psychometric-testing',
  '/course2': '/resources/career-library',
}

async function renamedPages() {
  const moved = {}
  // `previousSlugs.0` rather than `$ne: []` — the latter also matches every
  // page written before the field existed, which is all of them.
  const renamedOnly = { 'previousSlugs.0': { $exists: true } }
  const [courses, posts] = await Promise.all([
    Course.find({ active: true, ...renamedOnly }).select('slug previousSlugs').lean(),
    Blog.find({ published: true, ...renamedOnly }).select('slug previousSlugs').lean(),
  ])
  for (const row of [...courses, ...posts]) {
    for (const old of row.previousSlugs || []) {
      if (old && old !== row.slug) moved[`/${old}`] = `/${row.slug}`
    }
  }
  return moved
}

async function run() {
  await connectDB()
  const renamed = await renamedPages()
  const all = { ...MOVED_PAGES, ...renamed }

  const entries = Object.entries(all)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([from, to]) => `  ${JSON.stringify(from)}: ${JSON.stringify(to)},`)
    .join('\n')

  const file = `// CloudFront Function — viewer request. GENERATED, do not edit by hand.
//   cd server && npm run build:redirects
//
// Every address here answers with a 301, which is what tells a search engine to
// move a page's ranking across rather than treat the new address as a stranger.
//
// Articles and career pages that kept their original address are NOT here —
// all 274 of them still answer where they always did. This list is the pages
// that moved when the site left WordPress, plus anything renamed in the admin
// panel since, which is why it stays short enough to fit a CloudFront Function.
//
// Deploy:
//   aws cloudfront create-function --name svastrino-legacy-redirects \\
//     --function-config Comment="301s for pages that moved",Runtime=cloudfront-js-2.0 \\
//     --function-code fileb://legacy-redirects.js
//   aws cloudfront publish-function --name svastrino-legacy-redirects --if-match <ETag>
// then attach it to the default cache behaviour as a viewer-request function.
// Updating an existing one is \`update-function\` with the same arguments.

var MOVED = {
${entries}
}

function handler(event) {
  var request = event.request
  var uri = request.uri

  // WordPress served every page with a trailing slash. Match without it, so
  // both /bulls-eye and /bulls-eye/ are recognised.
  var key = uri.length > 1 && uri.charAt(uri.length - 1) === '/'
    ? uri.substring(0, uri.length - 1)
    : uri

  var target = MOVED[key.toLowerCase()]
  if (target) {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: target } },
    }
  }

  return request
}
`

  const bytes = Buffer.byteLength(file)
  if (bytes > MAX_BYTES) {
    throw new Error(
      `the function is ${bytes} bytes, over CloudFront's ${MAX_BYTES} limit — `
      + `${Object.keys(all).length} redirects is too many for one function`,
    )
  }

  writeFileSync(OUT, file)
  console.log(`✓ legacy-redirects.js — ${Object.keys(all).length} redirects, ${bytes} bytes (limit ${MAX_BYTES})`)
  console.log(`    ${Object.keys(MOVED_PAGES).length} pages that moved off WordPress`)
  console.log(`    ${Object.keys(renamed).length} renamed since, read from the database`)
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Redirects failed:', err.message)
  process.exit(1)
})
