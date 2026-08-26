// Seed the "Services" catalog (idempotent upsert).
//   npm run seed:mentoring
//
// Structure (3-level, like Skill Build → course → packages):
//   Services (kind:'mentoring' SkillBuilds = sub-categories)
//     • Career Counselling      → Bull's Eye Program
//     • Personalised Mentoring   → Bloom Program, Breakthrough Program
//
// Each program is a Package. Payments treats every program as an independent
// product (product = its SKU), so buying one is never an "upgrade" of another.
// SKUs are kept stable so existing enrolments/bookings keep working.
// Prices are PLACEHOLDERS in paise — edit any time in Admin → Services.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'
import { Package } from '../skillbuild/package.model.js'
import { formatInr } from '../../../utils/money.js'

// Sub-categories under "Services" (each is a kind:'mentoring' SkillBuild).
const SUBCATEGORIES = [
  {
    slug: 'career-counselling',
    name: 'Career Counselling',
    tagline: 'Focused guidance to get unstuck and choose with clarity',
    order: 1,
    programs: [
      {
        sku: 'mentoring-bullseye', slug: 'bulls-eye', name: "Bull's Eye Program",
        tagline: 'Sharp, focused guidance — 3 sessions',
        price: 799000, sessionsCount: 3, sessionMins: 120, period: 'one-time',
        features: ['3 one-on-one sessions (2 hrs each)', 'Personalised action plan', 'Session notes & tasks in your dashboard'],
        cta: 'Book Bull’s Eye', order: 1,
      },
    ],
  },
  {
    slug: 'personalised-mentoring',
    name: 'Personalised Mentoring',
    tagline: 'Ongoing one-on-one mentoring for the long journey',
    order: 2,
    programs: [
      {
        sku: 'mentoring-bloom', slug: 'bloom', name: 'Bloom Program',
        tagline: 'Grow steadily — 5 sessions',
        price: 2790000, sessionsCount: 5, sessionMins: 120, period: 'one-time',
        features: ['5 one-on-one sessions (2 hrs each)', 'Progress tracking across sessions', 'Session notes & tasks in your dashboard'],
        cta: 'Book Bloom', featured: true, badge: 'Most Popular', order: 1,
      },
      {
        // Sold after a call, never straight from the checkout — see the
        // Breakthrough row in the emotional flow.
        buyMode: 'expert-call',
        sku: 'mentoring-breakthrough', slug: 'breakthrough', name: 'Breakthrough Program',
        tagline: 'The full journey — 22 sessions',
        price: 13900000, sessionsCount: 22, sessionMins: 120, period: 'one-time',
        features: ['22 one-on-one sessions (2 hrs each)', 'Deep long-term mentoring', 'Session notes & tasks in your dashboard'],
        cta: 'Book Breakthrough', order: 2,
      },
    ],
  },
]

// Once a package exists the admin panel is the source of truth for money: the
// team edits prices in Admin → Services and a seed re-run must never quietly
// undo that. The seed therefore only supplies the *opening* price — `price` and
// `earlyBird` are written through $setOnInsert, which Mongo applies only when
// the document is created — while every descriptive field stays in $set so
// content fixes still land on programs that are already live.
const COMMERCIAL_FIELDS = ['price', 'earlyBird']

// Mongo rejects an update that names the same field in both $set and
// $setOnInsert, so the seed object is split field by field instead of being
// spread wholesale into $set.
function buildUpdate(program, alsoSet) {
  const $set = { ...alsoSet }
  const $setOnInsert = {}
  for (const [field, value] of Object.entries(program)) {
    if (COMMERCIAL_FIELDS.includes(field)) $setOnInsert[field] = value
    else $set[field] = value
  }
  return Object.keys($setOnInsert).length ? { $set, $setOnInsert } : { $set }
}

const earlyBirdLabel = (paise) => (paise == null ? 'none' : formatInr(paise))

// A stored price that survived the upsert unchanged means somebody edited it in
// the panel. Say so out loud, otherwise the seed looks like it applied a price
// that it deliberately left alone.
function reportKeptPrices(program, saved) {
  if (saved.price !== program.price) {
    console.log(`      • ${program.name} — kept the panel price ${formatInr(saved.price)} (seed says ${formatInr(program.price)})`)
  }
  if ('earlyBird' in program && saved.earlyBird !== program.earlyBird) {
    console.log(`      • ${program.name} — kept the panel early-bird price ${earlyBirdLabel(saved.earlyBird)} (seed says ${earlyBirdLabel(program.earlyBird)})`)
  }
}

async function run() {
  await connectDB()

  for (const sub of SUBCATEGORIES) {
    const parent = await SkillBuild.findOneAndUpdate(
      { slug: sub.slug },
      { $set: { slug: sub.slug, name: sub.name, tagline: sub.tagline, kind: 'mentoring', active: true, order: 10 + sub.order } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    console.log(`  ✓ Sub-category: ${parent.name}`)
    for (const p of sub.programs) {
      const saved = await Package.findOneAndUpdate(
        { sku: p.sku },
        buildUpdate(p, { skillBuild: parent._id, active: true }),
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      // Report what is actually stored, not what the seed wished for.
      console.log(`      • ${p.name} — ${p.sessionsCount} sessions · ${formatInr(saved.price)}`)
      reportKeptPrices(p, saved)
    }
  }

  // --- Clean up the old layout ---
  // Model Session is removed entirely; the old single 'mentoring' parent is
  // superseded by the two sub-categories above.
  const delPkg = await Package.deleteMany({ sku: 'mentoring-model-session' })
  if (delPkg.deletedCount) console.log(`  ✓ Removed Model Session program`)
  const staleSlugs = ['mentoring', 'model-session', 'mentoring-bullseye', 'mentoring-bloom', 'mentoring-breakthrough']
  const delSb = await SkillBuild.deleteMany({ slug: { $in: staleSlugs }, kind: 'mentoring' })
  if (delSb.deletedCount) console.log(`  ✓ Removed ${delSb.deletedCount} obsolete parent skill-build(s)`)

  console.log('✓ Services catalog seeded (prices editable in Admin → Services).')
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Seed failed:', err.message)
  process.exit(1)
})
