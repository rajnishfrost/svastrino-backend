import mongoose from 'mongoose'
import { SkillBuild } from './skillbuild.model.js'
import { Package } from './package.model.js'

/**
 * The Nirmaan pricing catalogue, as approved on the 2026 plans sheet.
 *
 * Four rows = the two axes the pricing page shows: plan (with or without the
 * psychometric test) x payment terms (pay once / pay as you use). They used to
 * be hard-coded in the page; the page now reads them from here through
 * /api/user/skill-build/nirmaan, so a price edited in the admin panel is both
 * the price the visitor sees and the price checkout charges.
 *
 * Money is PAISE. For a per-phase plan `price` is ONE instalment and the whole
 * run is price x phases — the convention payments already uses.
 *
 * Run:  node src/modules/user/skillbuild/seedNirmaanPackages.js [--dry]
 * Re-runnable: upserts by sku, never touches orders or enrollments.
 */

// Rows that must exist but must not be a card. 'nirmaan-clarity' predates this
// sheet and still has a paying student on it — payments looks their tier up by
// sku for the upgrade credit, so it stays; it just comes off the page.
// 'nirmaan-trial' is the free week, granted by learn/trial.js, never sold.
const RETIRE = ['nirmaan-clarity', 'nirmaan-trial']

const PACKAGES = [
  {
    "sku": "nirmaan-full",
    "slug": "full",
    "name": "Nirmaan Course",
    "price": 600000,
    "earlyBird": 450000,
    "phases": 6,
    "paymentMode": "one-time",
    "modeLabel": "Pay Once",
    "priceNote": "Flat 25% Discount",
    "includesPsychometric": false,
    "features": [
      "24 life changing concepts",
      "Structured personal skill development",
      "Structured professional skill development",
      "Tasks for daily development",
      "Daily progress tracking",
      "Daily reminders",
      "6 months course content",
      "1 year validity to complete the course",
      "Flat 25% support for students paying the whole fees at once"
    ],
    "benefits": [
      "Concepts planned for students specifically",
      "Mindset + Self-Development + Confidence + Action = Impact",
      "Strong self awareness & self belief",
      "Pay at once and get a 25% discount immediately"
    ],
    "cta": "Get Nirmaan",
    "period": "one-time",
    "durationDays": 365,
    "featured": true,
    "badge": "Best value",
    "variant": "btn-primary",
    "order": 1,
    "active": true,
    "listed": true
  },
  {
    "sku": "nirmaan-payu",
    "slug": "payu",
    "name": "Nirmaan Course",
    "price": 100000,
    "earlyBird": null,
    "phases": 6,
    "paymentMode": "per-phase",
    "modeLabel": "Pay As You Use",
    "priceNote": "Phase wise payment offer, No Interest at all",
    "includesPsychometric": false,
    "features": [
      "24 life changing aspects of future life",
      "Structured personal skill development",
      "Structured professional skill development",
      "Tasks for daily development",
      "Daily progress tracking",
      "Daily tasks reminders",
      "6 months course content",
      "Total course completion validity is 1 year",
      "Video and tasks validity is 1 year from 1st enrollment",
      "Each video can be played 5 times",
      "After the 1-year course period ends, tasks can be viewed for 3 years",
      "Spread the cost across 6 equal installments (Without Interest)"
    ],
    "benefits": [
      "Concepts planned for students specifically",
      "Mindset + Self-Development + Confidence + Action = Impact",
      "Strong self awareness & self belief",
      "Resume where you left off by paying for the next phase of the course"
    ],
    "cta": "Start with 1 phase",
    "period": "one-time",
    "durationDays": 365,
    "featured": false,
    "badge": null,
    "variant": "btn-secondary",
    "order": 2,
    "active": true,
    "listed": true
  },
  {
    "sku": "nirmaan-psy-full",
    "slug": "psy-full",
    "name": "Nirmaan + Psychometric Testing",
    "price": 690000,
    "earlyBird": 517500,
    "phases": 6,
    "paymentMode": "one-time",
    "modeLabel": "Pay Once",
    "priceNote": "Flat 25% Discount",
    "includesPsychometric": true,
    "features": [
      "24 life changing concepts",
      "Structured personal skill development",
      "Structured professional skill development",
      "Tasks for daily development",
      "Daily progress tracking",
      "Daily reminders",
      "6 months course content",
      "1 year validity to complete the course",
      "India's best psychometric testing",
      "Guidance based on the RIASEC scale",
      "Up to 40-page test report covering strengths, weakness, personality, interest, preferences and your top 5 suitable career options",
      "Psychometric testing is available only for students in Classes 7 to 12",
      "Flat 25% support for students paying the whole fees at once"
    ],
    "benefits": [
      "Concepts planned for students specifically",
      "Mindset + Self-Development + Confidence + Action = Impact",
      "Strong self awareness & self belief",
      "Pay at once and get a 25% discount immediately"
    ],
    "cta": "Get Nirmaan + Test",
    "period": "one-time",
    "durationDays": 365,
    "featured": false,
    "badge": null,
    "variant": "btn-secondary",
    "order": 3,
    "active": true,
    "listed": true
  },
  {
    "sku": "nirmaan-psy-payu",
    "slug": "psy-payu",
    "name": "Nirmaan + Psychometric Testing",
    "price": 115000,
    "earlyBird": null,
    "phases": 6,
    "paymentMode": "per-phase",
    "modeLabel": "Pay As You Use",
    "priceNote": "Phase wise payment offer, No Interest at all",
    "includesPsychometric": true,
    "features": [
      "24 life changing aspects of future life",
      "Structured personal skill development",
      "Structured professional skill development",
      "Tasks for daily development",
      "Daily progress tracking",
      "Daily tasks reminders",
      "6 months course content",
      "Total course completion validity is 1 year",
      "Video and tasks validity is 1 year from 1st enrollment",
      "Each video can be played 5 times",
      "After the 1-year course period ends, tasks can be viewed for 3 years",
      "India's best psychometric testing",
      "Guidance based on the RIASEC scale",
      "Up to 40-page test report covering strengths, weakness, personality, interest, preferences and your top 5 suitable career options",
      "Psychometric testing is available only for students in Classes 7 to 12",
      "Spread the cost across 6 equal installments (Without Interest)"
    ],
    "benefits": [
      "Concepts planned for students specifically",
      "Mindset + Self-Development + Confidence + Action = Impact",
      "Strong self awareness & self belief",
      "Resume where you left off by paying for the next phase of the course"
    ],
    "cta": "Start with 1 phase",
    "period": "one-time",
    "durationDays": 365,
    "featured": false,
    "badge": null,
    "variant": "btn-secondary",
    "order": 4,
    "active": true,
    "listed": true
  }
]

const dry = process.argv.includes('--dry')

async function main() {
  // MONGODB_URI is what the app itself uses (.env / .env.local), so running
  // this with the server's environment loaded hits the same database it does.
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/svastrino'
  await mongoose.connect(uri)
  console.log('db:', uri.replace(/\/\/[^@]*@/, '//***@'), dry ? '(dry run - kuchh likha nahi jayega)' : '')

  const sb = await SkillBuild.findOne({ slug: 'nirmaan' })
  if (!sb) throw new Error('Skill-Build "nirmaan" nahi mila - pehle wo banana hoga')

  for (const p of PACKAGES) {
    const existing = await Package.findOne({ sku: p.sku })
    const run = p.phases > 1 ? ' x ' + p.phases : ''
    if (dry) {
      console.log(' ', existing ? 'update ' : 'insert ', p.sku.padEnd(18), 'Rs' + p.price / 100 + run)
      continue
    }
    await Package.findOneAndUpdate(
      { sku: p.sku },
      { $set: { ...p, skillBuild: sb._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
    console.log(' ', existing ? 'updated ' : 'inserted', p.sku)
  }

  for (const sku of RETIRE) {
    if (!(await Package.findOne({ sku }))) continue
    if (dry) { console.log('  unlist  ', sku, '(active rahega)'); continue }
    await Package.updateOne({ sku }, { $set: { listed: false } })
    console.log('  unlisted', sku)
  }

  await mongoose.disconnect()
  console.log('done')
}

main().catch((e) => { console.error(e.message); process.exit(1) })
