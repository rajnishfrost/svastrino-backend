// Pushes the FAQs doc into the database WITHOUT running the full content seed.
//
// `seed:content` also does `Testimonial.deleteMany({})`, and the admin panel
// creates and edits testimonials (admin/testimonials/*) — so running it against
// a live database throws away whatever was added there. Its comment claiming
// nothing writes those collections is out of date.
//
// This touches exactly two things:
//   • the Faq collection — replaced wholesale (nothing else writes it)
//   • the three programs' `faqs` field — $set only, every other field untouched
//
// Dry run by default; pass --write to apply:
//   npm run sync:faqs              # report what would change
//   npm run sync:faqs -- --write   # apply
import '../../../config/env.js'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { Faq } from './faq.model.js'
import { MentoringProgram } from './program.model.js'

const here = dirname(fileURLToPath(import.meta.url))
const FAQS = JSON.parse(fs.readFileSync(join(here, 'data', 'faqs.json'), 'utf8'))

// Which doc section supplies each program page's own questions.
const PROGRAM_FAQ_SECTIONS = {
  'bulls-eye': "Bull's Eye Program",
  bloom: 'Bloom Program',
  breakthrough: 'Breakthrough Program',
}

const write = process.argv.includes('--write')

async function run() {
  await connectDB()

  // Say which database this is about to touch — the difference between a laptop
  // and the live cluster is one line in .env.local.
  const { host, name } = mongoose.connection
  console.log(`\nDatabase: ${name} @ ${host}`)
  console.log(write ? 'Mode: WRITE\n' : 'Mode: dry run (pass --write to apply)\n')

  const before = await Faq.countDocuments({})
  const groups = [...new Set(FAQS.map((f) => f.group))]
  console.log(`FAQs: ${before} in the database → ${FAQS.length} from the doc`)
  console.log(`  groups: ${groups.join(', ')}`)

  for (const [slug, section] of Object.entries(PROGRAM_FAQ_SECTIONS)) {
    const program = await MentoringProgram.findOne({ slug }).select('faqs').lean()
    const next = FAQS.filter((f) => f.section === section).length
    if (!program) {
      console.log(`  ! program '${slug}' not found — skipped`)
      continue
    }
    console.log(`  ${slug.padEnd(14)} ${(program.faqs || []).length} → ${next}`)
  }

  if (!write) {
    console.log('\nNothing written.')
    await mongoose.disconnect()
    return
  }

  await Faq.deleteMany({})
  await Faq.insertMany(FAQS.map((f, i) => ({ ...f, order: i, active: true })))
  console.log(`\n✓ FAQs replaced: ${FAQS.length}`)

  for (const [slug, section] of Object.entries(PROGRAM_FAQ_SECTIONS)) {
    const faqs = FAQS.filter((f) => f.section === section).map((f) => ({
      q: f.question,
      a: f.answer,
    }))
    const res = await MentoringProgram.updateOne({ slug }, { $set: { faqs } })
    console.log(`✓ ${slug}: ${faqs.length} FAQs (matched ${res.matchedCount})`)
  }

  console.log('\n✓ Done. Testimonials, career library and site pages were not touched.')
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('💥', err)
  process.exit(1)
})
