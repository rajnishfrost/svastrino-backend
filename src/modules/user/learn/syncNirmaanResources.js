// Put each Nirmaan week's written resource on its session.
//   node src/modules/user/learn/syncNirmaanResources.js
//   node src/modules/user/learn/syncNirmaanResources.js --dry
//
// The resource is the companion document to a week's video — the same ideas in
// writing, with the comparison tables and worked examples the video talks
// through. The student can read it on the page and download it as a PDF, but
// only once they have watched that week's video to the end. It is deliberately
// NOT part of the course payload: learn.service sends it from its own endpoint,
// for one session at a time, the same care the worksheet gets.
//
// Weeks come from data/nirmaanResources.json, which was lifted out of the
// course's RESOURCES document. All 24 weeks are there now: week 24 was only a
// note the author had written to themselves when this script was first written,
// so it was held back until the real section arrived. Week 24 still has no
// tasks — that one is by design, see syncNirmaanTasks.
//
// Separate from syncNirmaanTasks so the resources can be corrected without
// touching the tasks students have already answered.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectDB } from '../../../config/db.js'
import { Session } from './session.model.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'

const here = dirname(fileURLToPath(import.meta.url))
const WEEKS = JSON.parse(readFileSync(join(here, 'data', 'nirmaanResources.json'), 'utf8'))
const DRY = process.argv.includes('--dry')

/** A one-line description of what a week's resource holds, for the log. */
const shape = (blocks) => {
  const n = (t) => blocks.filter((b) => b.t === t).length
  return [
    `${n('h')} section${n('h') === 1 ? '' : 's'}`,
    `${n('p') + n('li')} paragraphs`,
    n('table') ? `${n('table')} table${n('table') === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(', ')
}

async function run() {
  await connectDB()
  const sb = await SkillBuild.findOne({ slug: 'nirmaan' })
  if (!sb) throw new Error('the nirmaan SkillBuild is missing')

  const sessions = await Session.find({ skillBuild: sb._id }).sort({ order: 1 }).lean()
  const byOrder = new Map(sessions.map((s) => [s.order, s]))
  console.log(`${DRY ? 'Would sync' : 'Syncing'} ${WEEKS.length} resources against ${sessions.length} sessions\n`)

  let written = 0
  const missing = []
  for (const w of WEEKS) {
    const session = byOrder.get(w.week)
    if (!session) { missing.push(w.week); console.log(`  ✗ W${w.week} — no session at order ${w.week}`); continue }
    if (!w.blocks?.length) { console.log(`  – W${w.week} — nothing to write`); continue }

    // The summary is written in the same breath as the blocks — a page that
    // advertises sections the document no longer has is worse than no page.
    const summary = {
      blocks: w.blocks.length,
      headings: w.blocks.filter((b) => b.t === 'h').map((b) => b.text),
    }
    if (!DRY) {
      await Session.updateOne({ _id: session._id }, { $set: { resourceBlocks: w.blocks, resourceSummary: summary } })
    }
    written += 1
    console.log(`  ✓ W${String(w.week).padStart(2, '0')} — ${shape(w.blocks)}`)
  }

  // A session the document has nothing for keeps nothing: a resource left over
  // from an earlier run would outlive the week it belonged to.
  const covered = new Set(WEEKS.map((w) => w.week))
  const stale = sessions.filter((s) => s.resourceBlocks && !covered.has(s.order))
  for (const s of stale) {
    console.log(`  ✂ order ${s.order} — clearing a resource the document no longer has`)
    if (!DRY) {
      await Session.updateOne({ _id: s._id }, { $set: { resourceBlocks: null, resourceSummary: { blocks: 0, headings: [] } } })
    }
  }

  console.log(`\n${DRY ? 'Would write' : 'Wrote'} ${written} resource(s)`)
  if (stale.length) console.log(`  ${stale.length} stale resource(s) ${DRY ? 'to clear' : 'cleared'}`)
  if (missing.length) console.log(`  ✗ no session for week(s): ${missing.join(', ')}`)
  const noResource = sessions.filter((s) => !covered.has(s.order)).map((s) => s.order)
  if (noResource.length) console.log(`  ${noResource.length} session(s) with no resource by design: order ${noResource.join(', ')}`)
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Resource sync failed:', err.message)
  process.exit(1)
})
