// Put the Nirmaan weeks' daily tasks in as their questions.
//   node src/modules/user/learn/syncNirmaanTasks.js
//   node src/modules/user/learn/syncNirmaanTasks.js --dry
//
// The six daily tasks ARE a week's questions: the student answers one a day,
// and answering the sixth is what opens the next video. They arrive in the
// course sheet with a worked example each, which becomes the placeholder in
// the box the student types into.
//
// Separate from ingestNirmaan so the text can be corrected without touching the
// videos — re-transcoding 24 lectures to fix a typo in a task would cost hours.
//
// Also clears out questions left pointing at sessions that no longer exist. The
// weeks replaced a ten-session course, and its questions asked about videos
// that are no longer in it.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectDB } from '../../../config/db.js'
import { Session } from './session.model.js'
import { Question } from './question.model.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'

const here = dirname(fileURLToPath(import.meta.url))
const WEEKS = JSON.parse(readFileSync(join(here, 'data', 'nirmaanWeeks.json'), 'utf8'))
const DRY = process.argv.includes('--dry')

async function run() {
  await connectDB()
  const sb = await SkillBuild.findOne({ slug: 'nirmaan' })
  if (!sb) throw new Error('the nirmaan SkillBuild is missing')

  const sessions = await Session.find({ skillBuild: sb._id }).sort({ order: 1 }).lean()
  const byOrder = new Map(sessions.map((s) => [s.order, s]))
  console.log(`${DRY ? 'Would sync' : 'Syncing'} ${WEEKS.length} weeks against ${sessions.length} sessions\n`)

  let written = 0, empty = []
  for (const w of WEEKS) {
    const session = byOrder.get(w.week)
    if (!session) { console.log(`  ✗ W${w.week} — no session at order ${w.week}`); continue }

    if (!w.days.length) {
      // Weeks 24 has no tasks by design; its video is the whole of it.
      empty.push(w.week)
      if (!DRY) await Question.deleteMany({ session: session._id })
      continue
    }

    if (DRY) {
      console.log(`  ? W${String(w.week).padStart(2, '0')} — ${w.days.length} tasks, ${w.days.filter((d) => d.example).length} with an example`)
      continue
    }

    await Question.deleteMany({ session: session._id })
    await Question.insertMany(w.days.map((d) => ({
      session: session._id,
      skillBuild: sb._id,
      order: d.day,
      prompt: d.task,
      placeholder: d.example || '',
      active: true,
    })))
    written += w.days.length
    console.log(`  ✓ W${String(w.week).padStart(2, '0')} — ${w.days.length} tasks`)
  }

  // Anything still pointing at a session that is gone.
  const liveIds = sessions.map((s) => s._id)
  const orphans = await Question.countDocuments({ session: { $nin: liveIds } })
  if (orphans && !DRY) await Question.deleteMany({ session: { $nin: liveIds } })

  console.log(`\n${DRY ? 'Would write' : 'Wrote'} ${written} questions`)
  if (empty.length) console.log(`  ${empty.length} week(s) left with none, by design: ${empty.join(', ')}`)
  console.log(`  ${orphans} orphaned question(s) ${DRY ? 'to remove' : 'removed'}`)
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Task sync failed:', err.message)
  process.exit(1)
})
