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
//
// This function assumes the distribution answers 403 and 404 with /404.html at
// a 404 status. Pointed at /index.html with a 200 instead — which is how it
// shipped — every address that misses answers with the home page, and the app
// routes below are the only thing that keeps working.

var MOVED = {
${entries}
}

// Addresses that belong to the app rather than to a page: nothing prerenders a
// dashboard, so none of these has a file behind it. Matched a whole segment at
// a time, because /learn-how-to-be-successful-by-cultivating-a-growth-mindset
// is an article and not the /learn area.
var APP_ROUTES = [
  '/admin', '/checkout', '/dashboard', '/downloads', '/learn', '/login',
  '/organisation', '/reset-password', '/settings', '/support', '/verify-email',
  '/welcome',
]

function handler(event) {
  var request = event.request
  var uri = request.uri
  var host = request.headers.host ? request.headers.host.value : ''

  // Carried onto every redirect below. Dropping it would throw away the
  // ?utm_source on a campaign link at the moment the click is counted.
  var qs = ''
  for (var name in request.querystring) {
    var value = request.querystring[name].value
    qs += (qs ? '&' : '?') + name + (value ? '=' + value : '')
  }

  function moved(to) {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: to } },
    }
  }

  // WordPress served every page with a trailing slash. Match without it, so
  // both /bulls-eye and /bulls-eye/ are recognised.
  var key = uri.length > 1 && uri.charAt(uri.length - 1) === '/'
    ? uri.substring(0, uri.length - 1)
    : uri
  var lower = key.toLowerCase()

  // www and the apex are aliases of one distribution, so both answer
  // everything, and a page reachable at two addresses splits its own ranking.
  // Written as a prefix rather than a redirect of its own so that www, a
  // trailing slash and a moved address together still cost a single hop.
  var isWww = host.indexOf('www.') === 0
  var prefix = isWww ? 'https://' + host.substring(4) : ''

  var target = MOVED[lower]
  if (target) {
    return moved(prefix + target + (target.indexOf('?') === -1 ? qs : ''))
  }

  if (isWww || key !== uri) {
    return moved(prefix + key + qs)
  }

  // Anything carrying a file extension is left alone, so a genuinely missing
  // asset still fails as one.
  var last = key.substring(key.lastIndexOf('/') + 1)
  if (last.indexOf('.') !== -1) {
    return request
  }

  // An app route is pointed at the shell by name. These used to arrive here,
  // miss, and be rescued by the distribution's 403/404 rule — which now
  // answers a real 404, because a miss has to mean missing.
  for (var i = 0; i < APP_ROUTES.length; i++) {
    if (lower === APP_ROUTES[i] || lower.indexOf(APP_ROUTES[i] + '/') === 0) {
      request.uri = '/app.html'
      return request
    }
  }

  // Point an address at the file that holds it.
  //
  // Prerendering writes each page as <path>/index.html, and an S3 REST origin
  // has no notion of a directory index: asked for /law it looks for an object
  // named "law" and finds nothing.
  //
  // An address with no file behind it misses, and the 403/404 rule answers
  // /404.html with a 404 status. That rule is the whole point: while it
  // returned the home page at 200, every typo and every retired WordPress
  // address was another copy of the home page, and Google filed a few hundred
  // of them under "crawled, currently not indexed".
  request.uri = key === '/' ? '/index.html' : key + '/index.html'

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
