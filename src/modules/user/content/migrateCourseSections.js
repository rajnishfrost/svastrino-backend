// Fold each course page's fixed sections into its editor document.
//   npm run migrate:course-sections -- --dry    # report, change nothing
//   npm run migrate:course-sections
//
// The course page used to be a form — a box for qualities, one for institutes,
// a repeater for careers and salaries — and the page drew a section from each.
// The page is now one document an admin writes freely, so that content has to
// move INTO the document or the pages lose everything below the overview.
//
// Run this BEFORE deploying the new page. Nothing is deleted here: the old
// fields stay in the database untouched, so the backup isn't the only way back.
//
// A course whose document already has headings is left alone, which makes this
// safe to run twice — and every line that went in is read back out and checked
// against what it came from, so a course is only written when nothing was lost.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { Course } from './course.model.js'
import { sectionsToBlocks } from './legacySections.js'
import { blocksToText, sanitizeBlocks } from './richText.js'

const dry = process.argv.includes('--dry')

/** Every line the old fields held — each one has to survive the conversion. */
const expectedLines = (c) => [
  ...(c.topQualities || []),
  ...(c.topJobs || []).flatMap((j) => [j.role, j.description, j.indiaSalary, j.globalSalary]),
  ...(c.institutesIndia || []),
  ...(c.institutesInternational || []),
  ...(c.careerLadder || []),
].map((s) => String(s || '').trim()).filter(Boolean)

const normalise = (s) => String(s).replace(/\s+/g, ' ').trim()

async function run() {
  await connectDB()
  const courses = await Course.find().sort({ slug: 1 })

  let converted = 0
  let already = 0
  const failed = []

  for (const c of courses) {
    const hasSections = (c.overviewBlocks?.blocks || []).some((b) => b.type === 'header')
    if (hasSections) {
      already++
      continue
    }

    const doc = sanitizeBlocks(sectionsToBlocks(c))
    if (!doc) {
      failed.push(`${c.slug} — nothing to write`)
      continue
    }

    // Read the document back as text and look for every line that went in.
    const text = normalise(blocksToText(doc))
    const missing = expectedLines(c).filter((line) => !text.includes(normalise(line)))
    if (missing.length) {
      failed.push(`${c.slug} — ${missing.length} line(s) missing, e.g. “${missing[0].slice(0, 60)}”`)
      continue
    }

    if (!dry) {
      await Course.updateOne(
        { _id: c._id },
        { $set: { overviewBlocks: doc, overview: blocksToText(doc) } }
      )
    }
    converted++
    const counts = doc.blocks.reduce((m, b) => ({ ...m, [b.type]: (m[b.type] || 0) + 1 }), {})
    console.log(`  ✓  ${c.slug} — ${doc.blocks.length} blocks (${Object.entries(counts).map(([t, n]) => `${n} ${t}`).join(', ')})`)
  }

  console.log(`\n${dry ? 'Would convert' : 'Converted'}: ${converted} of ${courses.length}`)
  if (already) console.log(`Already had sections, left alone: ${already}`)
  if (failed.length) {
    console.log(`\n⚠️  SKIPPED — convert these by hand:`)
    failed.forEach((f) => console.log(`     ${f}`))
  }

  await mongoose.disconnect()
}

run().catch(async (err) => {
  console.error('💥', err)
  await mongoose.disconnect()
  process.exit(1)
})
