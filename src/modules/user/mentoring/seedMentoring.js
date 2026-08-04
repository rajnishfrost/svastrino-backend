// Seed the counselling/mentoring catalog (idempotent upsert).
//   npm run seed:mentoring
// ONE parent SkillBuild (slug 'mentoring', kind 'mentoring') — the category —
// with each program (Bull's Eye / Bloom / Breakthrough) as a Package under it.
// Payments treats each program as an independent product (product = its SKU),
// so buying a second program is never an "upgrade" of the first.
// Prices are PLACEHOLDERS in paise — edit them any time in Admin → Packages.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'
import { Package } from '../skillbuild/package.model.js'

const PARENT = {
  slug: 'mentoring',
  name: 'Mentoring',
  tagline: 'One-on-one counselling & mentoring programs',
  kind: 'mentoring',
  order: 10,
}

const PROGRAMS = [
  {
    sku: 'mentoring-model-session', slug: 'model-session', name: 'Model Session',
    tagline: 'Experience Svastrino mentoring — a one-off intro session',
    price: 49900, sessionsCount: 1, sessionMins: 120, period: 'one-time',
    features: ['1 one-on-one session (2 hrs)', 'Meet your mentor & set direction', 'Session notes & tasks in your dashboard'],
    cta: 'Book a Model Session', order: 0,
  },
  {
    sku: 'mentoring-bullseye', slug: 'bullseye', name: "Bull's Eye",
    tagline: 'Sharp, focused guidance — 3 sessions',
    price: 299900, sessionsCount: 3, sessionMins: 120, period: 'one-time',
    features: ['3 one-on-one sessions (2 hrs each)', 'Personalised action plan', 'Session notes & tasks in your dashboard'],
    cta: 'Book Bull’s Eye', order: 1,
  },
  {
    sku: 'mentoring-bloom', slug: 'bloom', name: 'Bloom',
    tagline: 'Grow steadily — 5 sessions',
    price: 499900, sessionsCount: 5, sessionMins: 120, period: 'one-time',
    features: ['5 one-on-one sessions (2 hrs each)', 'Progress tracking across sessions', 'Session notes & tasks in your dashboard'],
    cta: 'Book Bloom', featured: true, badge: 'Most Popular', order: 2,
  },
  {
    sku: 'mentoring-breakthrough', slug: 'breakthrough', name: 'Breakthrough',
    tagline: 'The full journey — 22 sessions',
    price: 1999900, sessionsCount: 22, sessionMins: 120, period: 'one-time',
    features: ['22 one-on-one sessions (2 hrs each)', 'Deep long-term mentoring', 'Session notes & tasks in your dashboard'],
    cta: 'Book Breakthrough', order: 3,
  },
]

async function run() {
  await connectDB()

  const parent = await SkillBuild.findOneAndUpdate(
    { slug: PARENT.slug },
    { $set: { ...PARENT, active: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  console.log(`  ✓ Parent: ${parent.name} (kind: ${parent.kind})`)

  for (const p of PROGRAMS) {
    await Package.findOneAndUpdate(
      { sku: p.sku },
      { $set: { ...p, skillBuild: parent._id, active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    console.log(`  ✓ ${p.name} — ${p.sessionsCount} sessions · ₹${(p.price / 100).toLocaleString('en-IN')}`)
  }

  // Migration from the earlier per-program-SkillBuild layout: those parents
  // (mentoring-bullseye/-bloom/-breakthrough) are obsolete — packages were just
  // repointed to the single parent above, so drop the leftover builds.
  const stale = await SkillBuild.deleteMany({ slug: { $in: PROGRAMS.map((p) => p.sku) } })
  if (stale.deletedCount) console.log(`  ✓ Removed ${stale.deletedCount} old per-program skill-builds`)

  console.log('✓ Mentoring catalog seeded (prices editable in Admin → Packages).')
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Seed failed:', err.message)
  process.exit(1)
})
