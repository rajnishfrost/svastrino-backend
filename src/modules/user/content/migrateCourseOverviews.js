// Give every existing course page an editor document.
//   npm run migrate:course-blocks -- --dry    # report, change nothing
//   npm run migrate:course-blocks
//
// The 52 migrated course pages hold their overview as one plain paragraph. The
// panel now edits that overview as Editor.js blocks, so each one needs a
// document to open — without it the editor would start empty and the first
// save would wipe an overview nobody meant to touch.
//
// Only courses that have no document yet are written, so this is safe to run
// again: a second run reports "already done" rather than overwriting whatever
// an admin has since written. The plain `overview` field is left exactly as it
// is — it stays the mirror, and the text is unchanged by the conversion.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { Course } from './course.model.js'
import { blocksToText, textToBlocks } from './richText.js'

const dry = process.argv.includes('--dry')

async function run() {
  await connectDB()

  const courses = await Course.find({
    $or: [{ overviewBlocks: null }, { overviewBlocks: { $exists: false } }],
  }).select('slug name overview')

  const total = await Course.countDocuments()
  console.log(`${courses.length} of ${total} course pages have no editor document yet${dry ? ' (dry run)' : ''}\n`)

  let written = 0
  let empty = 0
  const drifted = []

  for (const c of courses) {
    const doc = textToBlocks(c.overview)
    if (!doc) {
      empty++
      console.log(`  –  ${c.slug} — no overview to convert, left alone`)
      continue
    }

    // The conversion must not change a word of what the page says today. If it
    // ever does, that course is reported and skipped rather than quietly
    // rewritten.
    if (blocksToText(doc).replace(/\s+/g, ' ') !== String(c.overview).replace(/\s+/g, ' ').trim()) {
      drifted.push(c.slug)
      continue
    }

    if (!dry) {
      await Course.updateOne({ _id: c._id }, { $set: { overviewBlocks: doc } })
    }
    written++
    console.log(`  ✓  ${c.slug} — ${doc.blocks.length} paragraph${doc.blocks.length === 1 ? '' : 's'}`)
  }

  console.log(`\n${dry ? 'Would convert' : 'Converted'}: ${written}`)
  if (empty) console.log(`Skipped (empty overview): ${empty}`)
  if (drifted.length) {
    console.log(`\n⚠️  Text would have changed — SKIPPED, convert these by hand:`)
    drifted.forEach((s) => console.log(`     ${s}`))
  }

  await mongoose.disconnect()
}

run().catch(async (err) => {
  console.error('💥', err)
  await mongoose.disconnect()
  process.exit(1)
})
