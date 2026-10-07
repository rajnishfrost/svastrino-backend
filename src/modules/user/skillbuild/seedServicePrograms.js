// Loads .env.local the way every other script does. Without it this file fell
// back to a localhost URI, so running it plainly wrote to whatever database
// happened to be on this machine and reported success — a silent no-op against
// the database the site actually reads.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { Package } from './package.model.js'

/**
 * The three Services programs, aligned with what the /services cards showed.
 *
 * The card copy used to live in the client (journeyStages.js ALL_PROGRAMS)
 * while the price and the buy rule lived in the catalogue — two owners for one
 * program. That is how Breakthrough ended up marked 'expert-call' on the page
 * and 'self-serve' in the database, disagreeing with each other. The catalogue
 * is the only owner now.
 *
 * All three are 'self-serve': someone who has reached Book Online has already
 * decided, and putting a call in front of them there is a negotiation nobody
 * asked for. Breakthrough was the exception until 2026-09-19. The expert-call
 * mode still exists and the admin panel can set it per program.
 *
 * Text is copied verbatim from that file; nothing here is reworded.
 *
 * Run:  node src/modules/user/skillbuild/seedServicePrograms.js [--dry]
 * Re-runnable: matches by sku and only writes the card fields, so prices,
 * features and session counts already in the catalogue are left alone.
 */

const PROGRAMS = [
  {
    "sku": "mentoring-bullseye",
    "slug": "bulls-eye",
    "name": "Bull's Eye Program",
    "tagline": "Get a quick yet accurate solution for your career confusion",
    "summary": "Two focused sessions of about 2.5 hours each, designed to achieve clarity when you are stuck between options or facing a deadline — ending with concrete career recommendations and a plan.",
    "trustLine": "",
    "durationLabel": "About 10 days",
    "sessionsLabel": "2 sessions of about 2.5 hours each, including the pre-session, follow-ups in between sessions\n",
    "deliveryMode": "Online",
    "buyMode": "self-serve",
    "categorySlug": "career-counselling"
  },
  {
    "sku": "mentoring-bloom",
    "slug": "bloom",
    "name": "Bloom Program",
    "tagline": "Cultivate a visionary mindset and set goals for a bright future",
    "summary": "Svastrino's personality-based mentoring programme. Over about 2 months it moves from a full personality analysis through self-discovery tasks and vision building, ending in a personalised 5-year career plan.",
    "trustLine": "",
    "durationLabel": "About 2 months",
    "sessionsLabel": "Pre-session of 90 minutes, 3 sessions of about 2.5 hours each, weekly follow-ups and support throughout the program",
    "deliveryMode": "Online",
    "buyMode": "self-serve",
    "categorySlug": "personalised-mentoring"
  },
  {
    "sku": "mentoring-breakthrough",
    "slug": "breakthrough",
    "name": "Breakthrough Program",
    "tagline": "Ace the art of self-discipline and evolve into an enterprising leader",
    "summary": "A two-year personalised mentoring program to craft future leaders and entrepreneurs — building mindset first, then attitude, with consistent mentoring and accountability across academics, professional skills, experience, extracurriculars and social work.",
    "trustLine": "",
    "durationLabel": "2 Years",
    "sessionsLabel": "Pre-session of 90 minutes, 10 sessions of 2.5 hours each or 20 sessions of 1 to 1.5 hour each (depending on the student's pace, availability and comfort), weekly follow-ups and support in between sessions, at least 2,200 minutes of mentoring with follow-ups",
    "sessionsShort": "10 sessions of 2.5 hours each, or 20 sessions of 1 to 1.5 hours each",
    "deliveryMode": "Online",
    "buyMode": "self-serve",
    "expertEnquiry": true,
    "categorySlug": "personalised-mentoring"
  }
]

const dry = process.argv.includes('--dry')

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/svastrino'
  await mongoose.connect(uri)
  console.log('db:', uri.replace(/\/\/[^@]*@/, '//***@'), dry ? '(dry run - kuchh likha nahi jayega)' : '')

  for (const p of PROGRAMS) {
    const cur = await Package.findOne({ sku: p.sku })
    if (!cur) { console.log(`  ${p.sku}: catalogue me nahi mila - SKIP`); continue }

    const set = {
      slug: p.slug,
      name: p.name,
      tagline: p.tagline,
      summary: p.summary,
      trustLine: p.trustLine,
      durationLabel: p.durationLabel,
      sessionsLabel: p.sessionsLabel,
      sessionsShort: p.sessionsShort || '',
      deliveryMode: p.deliveryMode,
      buyMode: p.buyMode,
      // Written outright, not left to the model default: $set leaves an
      // existing key alone when the payload omits it, so an omitted flag would
      // never clear a stale value.
      expertEnquiry: !!p.expertEnquiry,
    }
    const changed = Object.entries(set).filter(([k, v]) => String(cur[k] ?? '') !== String(v))
    if (!changed.length) { console.log(`  ${p.sku}: pehle se same`); continue }
    if (dry) {
      console.log(`  ${p.sku}:`)
      for (const [k, v] of changed) console.log(`      ${k}: ${JSON.stringify(cur[k] ?? null)} -> ${JSON.stringify(v).slice(0, 70)}`)
      continue
    }
    await Package.updateOne({ _id: cur._id }, { $set: set })
    console.log(`  ${p.sku}: updated (${changed.map(([k]) => k).join(', ')})`)
  }

  await mongoose.disconnect()
  console.log('done')
}

main().catch((e) => { console.error(e.message); process.exit(1) })
