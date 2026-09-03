// Put the Nirmaan weeks' daily tasks in as their questions.
//   node src/modules/user/learn/syncNirmaanTasks.js
//   node src/modules/user/learn/syncNirmaanTasks.js --dry
//
// Also re-writes each week's TEXT on its session: the title, the rule shown
// under the video, and the worksheet panel. Those come from the same sheet rows
// as the tasks, so a sheet edit that renames a week or rewrites its rule would
// otherwise only land half-way — new tasks under an old heading. Only the text
// is touched: videoUrl, durationMins and captions are left exactly as they are.
//
// The six daily tasks ARE a week's questions: the student answers one a day,
// and answering the sixth is what opens the next video. They arrive in the
// course sheet with a worked example each, which becomes the placeholder in
// the box the student types into.
//
// Separate from ingestNirmaan so the text can be corrected without touching the
// videos — re-transcoding 24 lectures to fix a typo in a task would cost hours.
//
// Questions are matched on (session, order) and updated in place, so their ids
// survive a re-run and the answers students have already written stay attached
// to them. Only a task that no longer exists is removed.
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
import { titleFor, descriptionFor, worksheetFor } from './nirmaanText.js'

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

  let written = 0, retitled = 0, empty = []
  for (const w of WEEKS) {
    const session = byOrder.get(w.week)
    if (!session) { console.log(`  ✗ W${w.week} — no session at order ${w.week}`); continue }

    // The week's own text, from the same sheet row as its tasks.
    const text = { title: titleFor(w), description: descriptionFor(w), worksheet: worksheetFor(w) }
    const titleChanged = session.title !== text.title
    const descChanged = (session.description || '') !== text.description
    if (titleChanged || descChanged) {
      retitled += 1
      if (titleChanged) console.log(`  ~ W${String(w.week).padStart(2, '0')} title  → ${text.title}`)
      if (descChanged) console.log(`  ~ W${String(w.week).padStart(2, '0')} rule   → ${text.description.slice(0, 72)}`)
    }
    if (!DRY) await Session.updateOne({ _id: session._id }, { $set: text })

    if (!w.days.length) {
      // Weeks 24 has no tasks by design; its video is the whole of it.
      empty.push(w.week)
      if (!DRY) await Question.deleteMany({ session: session._id })
      continue
    }

    if (DRY) {
      // Counted here too, so the closing summary tells the truth about what a
      // real run would do rather than always reporting zero.
      written += w.days.length
      console.log(`  ? W${String(w.week).padStart(2, '0')} — ${w.days.length} tasks, ${w.days.filter((d) => d.example).length} with an example`)
      continue
    }

    // Matched on (session, order) and updated in place, NEVER deleted and
    // re-made. An Answer points at a question by its id, so recreating the row
    // would cut every student's work loose from the task they wrote it for:
    // the page would count them as unanswered and ask for them again. The text
    // of day 3 can change; day 3 itself is the same question it always was.
    const res = await Question.bulkWrite(w.days.map((d) => ({
      updateOne: {
        filter: { session: session._id, order: d.day },
        update: {
          $set: { prompt: d.task, placeholder: d.example || '', active: true },
          $setOnInsert: { session: session._id, skillBuild: sb._id, order: d.day },
        },
        upsert: true,
      },
    })))

    // A week that lost days: anything past the end of the new list is gone.
    const stale = await Question.deleteMany({
      session: session._id,
      order: { $nin: w.days.map((d) => d.day) },
    })

    written += w.days.length
    const made = res.upsertedCount || 0
    console.log(
      `  ✓ W${String(w.week).padStart(2, '0')} — ${w.days.length} tasks` +
      ` (${w.days.length - made} updated in place, ${made} new` +
      `${stale.deletedCount ? `, ${stale.deletedCount} removed` : ''})`
    )
  }

  // Anything still pointing at a session that is gone.
  const liveIds = sessions.map((s) => s._id)
  const orphans = await Question.countDocuments({ session: { $nin: liveIds } })
  if (orphans && !DRY) await Question.deleteMany({ session: { $nin: liveIds } })

  console.log(`\n${DRY ? 'Would write' : 'Wrote'} ${written} questions`)
  console.log(`  ${retitled} week(s) whose title or rule ${DRY ? 'would change' : 'changed'}`)
  if (empty.length) console.log(`  ${empty.length} week(s) left with none, by design: ${empty.join(', ')}`)
  console.log(`  ${orphans} orphaned question(s) ${DRY ? 'to remove' : 'removed'}`)
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Task sync failed:', err.message)
  process.exit(1)
})
