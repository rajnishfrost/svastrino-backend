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
        price: 299900, sessionsCount: 3, sessionMins: 120, period: 'one-time',
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
        price: 499900, sessionsCount: 5, sessionMins: 120, period: 'one-time',
        features: ['5 one-on-one sessions (2 hrs each)', 'Progress tracking across sessions', 'Session notes & tasks in your dashboard'],
        cta: 'Book Bloom', featured: true, badge: 'Most Popular', order: 1,
      },
      {
        sku: 'mentoring-breakthrough', slug: 'breakthrough', name: 'Breakthrough Program',
        tagline: 'The full journey — 22 sessions',
        price: 1999900, sessionsCount: 22, sessionMins: 120, period: 'one-time',
        features: ['22 one-on-one sessions (2 hrs each)', 'Deep long-term mentoring', 'Session notes & tasks in your dashboard'],
        cta: 'Book Breakthrough', order: 2,
      },
    ],
  },
]

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
      await Package.findOneAndUpdate(
        { sku: p.sku },
        { $set: { ...p, skillBuild: parent._id, active: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      console.log(`      • ${p.name} — ${p.sessionsCount} sessions · ₹${(p.price / 100).toLocaleString('en-IN')}`)
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
