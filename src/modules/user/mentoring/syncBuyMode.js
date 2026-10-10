// Puts the buy/enquiry flags in the database back in step with the seeds.
//
// Both flags live in two collections — Package (the catalogue behind
// /book-online and the /services cards) and MentoringProgram (the
// /services/:slug page) — and the admin panel only edits the first. Changing a
// program's rule by hand therefore fixes some surfaces and leaves others as
// they were, which is how Breakthrough ended up saying "Book Now" on one page
// and "Talk to an Expert" on another.
//
// The seeds write with $set, so dropping a key from them leaves the old value
// sitting in rows that already have it. This writes the value outright.
//
// Dry run by default; pass --write to apply:
//   npm run sync:buymode
//   npm run sync:buymode -- --write
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { Package } from '../skillbuild/package.model.js'
import { MentoringProgram } from '../content/program.model.js'

// What each program's two flags should be, matching seedServicePrograms.js.
//   buyMode       — can the checkout take the money?
//   expertEnquiry — does the program page lead with the call-back form?
// Breakthrough is both: bought outright at the listed price from /book-online,
// and also offered at a negotiated price through the form on its own page.
const FLAGS = [
  { slug: 'bulls-eye', sku: 'mentoring-bullseye', buyMode: 'self-serve', expertEnquiry: false },
  { slug: 'bloom', sku: 'mentoring-bloom', buyMode: 'self-serve', expertEnquiry: false },
  { slug: 'breakthrough', sku: 'mentoring-breakthrough', buyMode: 'self-serve', expertEnquiry: true },
]

const write = process.argv.includes('--write')

async function run() {
  await connectDB()
  const { host, name } = mongoose.connection
  console.log(`\nDatabase: ${name} @ ${host}`)
  console.log(write ? 'Mode: WRITE\n' : 'Mode: dry run (pass --write to apply)\n')

  let changes = 0

  for (const { slug, sku, buyMode, expertEnquiry } of FLAGS) {
    const pkg = await Package.findOne({ sku }).select('buyMode expertEnquiry').lean()
    const prog = await MentoringProgram.findOne({ slug }).select('buyMode expertEnquiry').lean()

    for (const [label, row, filter, Model] of [
      ['catalogue', pkg, { sku }, Package],
      ['program page', prog, { slug }, MentoringProgram],
    ]) {
      if (!row) {
        console.log(`  ${slug} · ${label}: not found — skipped`)
        continue
      }

      // Both flags, in one pass. expertEnquiry is compared against `undefined`
      // rather than `false` because rows written before the field existed do
      // not carry it at all, and those need writing just as much.
      const want = { buyMode, expertEnquiry }
      const have = { buyMode: row.buyMode || 'self-serve', expertEnquiry: row.expertEnquiry }
      const diff = Object.keys(want).filter((k) => have[k] !== want[k])

      if (!diff.length) {
        console.log(`  ${slug} · ${label}: already buyMode=${buyMode} expertEnquiry=${expertEnquiry}`)
        continue
      }
      changes += diff.length
      for (const k of diff) {
        console.log(`  ${slug} · ${label}: ${k} ${have[k] === undefined ? '(unset)' : have[k]} -> ${want[k]}`)
      }
      if (write) await Model.updateOne(filter, { $set: want })
    }
  }

  console.log(
    write
      ? `\n✓ ${changes} value(s) written. Nothing else was touched.`
      : `\n${changes} value(s) would change. Nothing written.`
  )
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('💥', err)
  process.exit(1)
})
