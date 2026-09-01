/**
 * Dev utility: walk one student through the WHOLE course in a few seconds and
 * check that the chain behaves — the thing that otherwise takes as many real
 * days as the course has tasks.
 *
 *   LEARN_TEST_MODE=1 npm run check:learn -- <email> [slug]
 *   e.g. LEARN_TEST_MODE=1 npm run check:learn -- rajnishfrost@gmail.com nirmaan
 *
 * It calls the same service functions the HTTP routes call — no shortcuts around
 * the gates — so anything it reports is what a student would meet. At each step
 * it asserts what SHOULD be true and, just as importantly, tries what should be
 * refused (answering a locked question, answering the same one twice, opening a
 * video before the week before it is finished). A gate that has quietly stopped
 * working shows up as a failed "refused" check, not as a pass.
 *
 * DESTRUCTIVE for that one student on that one course: it wipes their start
 * marker, progress and answers first, and fills the course with its own answers.
 * Use a test account, never a real student's.
 *
 * Needs LEARN_TEST_MODE=1, because without it the second task of the course is
 * behind tomorrow's midnight and the walk cannot continue.
 */
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { User } from '../credentials/credentials.model.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'
import { Enrollment } from '../payments/enrollment.model.js'
import { Progress } from './progress.model.js'
import { Answer } from './answer.model.js'
import { LearnState } from './learnState.model.js'
import * as learn from './learn.service.js'

let passed = 0
const failures = []

/** Assert something the flow promises. Records, never throws — the walk goes on. */
function check(label, ok, detail = '') {
  if (ok) { passed++; return true }
  failures.push(detail ? `${label} — ${detail}` : label)
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  return false
}

/** Assert that an action is REFUSED. A gate that stopped refusing is a bug. */
async function checkRefused(label, fn, expectCode) {
  try {
    await fn()
  } catch (err) {
    if (expectCode && err.code !== expectCode) {
      return check(label, false, `refused with "${err.code || err.message}", expected ${expectCode}`)
    }
    passed++
    return true
  }
  return check(label, false, 'it was ALLOWED')
}

async function run() {
  const email = process.argv[2]
  const slug = process.argv[3] || 'nirmaan'
  if (!email) {
    console.error('Usage: LEARN_TEST_MODE=1 npm run check:learn -- <email> [slug]')
    process.exit(1)
  }
  if (!learn.TEST_MODE) {
    console.error(
      '✗ LEARN_TEST_MODE is off, so every task after the first is behind tomorrow\'s\n' +
      '  midnight and this walk cannot get past task 1. Run it as:\n' +
      `    LEARN_TEST_MODE=1 npm run check:learn -- ${email} ${slug}`
    )
    process.exit(1)
  }

  await connectDB()
  const user = await User.findOne({ email })
  if (!user) { console.error(`✗ No user with email "${email}"`); process.exit(1) }
  const sb = await SkillBuild.findOne({ slug })
  if (!sb) { console.error(`✗ No skill-build "${slug}"`); process.exit(1) }

  const enrolments = await Enrollment.find({ user: user._id, product: slug, status: 'active' })
  if (!enrolments.length) {
    console.error(`✗ ${email} is not enrolled in "${slug}" — buy it for this account first (or seed an enrollment), then run this again.`)
    process.exit(1)
  }
  const phases = enrolments.reduce((a, b) => (b.phasesUnlocked > a.phasesUnlocked ? b : a))
  console.log(`\nWalking "${slug}" as ${email} — package ${phases.packageName}, phases ${phases.phasesUnlocked}/${phases.phasesTotal}\n`)

  // --- clean slate -------------------------------------------------------
  const f = { user: user._id, skillBuild: sb._id }
  await Promise.all([LearnState.deleteMany(f), Progress.deleteMany(f), Answer.deleteMany(f)])

  const uid = String(user._id)
  let course = await learn.getCourse(uid, slug)
  check('before Start: the course is not started', course.started === false)
  check('before Start: every video is locked', course.sessions.every((s) => s.videoLocked),
    `${course.sessions.filter((s) => !s.videoLocked).length} were open`)
  check('the server reports test mode to the client', course.testMode === true)

  // --- start -------------------------------------------------------------
  course = await learn.startCourse(uid, slug)
  check('after Start: video 1 is open', course.sessions[0] && !course.sessions[0].videoLocked)
  check('after Start: video 2 is still shut', !course.sessions[1] || course.sessions[1].videoLocked)

  // A task cannot be answered before its video is watched.
  const firstQ = course.sessions[0]?.questions
  check('before watching: no task is open yet', !firstQ?.current)

  // --- walk every session ------------------------------------------------
  let tasksAnswered = 0
  for (let i = 0; i < course.sessions.length; i++) {
    const s = course.sessions[i]

    if (s.phaseLocked) {
      console.log(`\n· Week ${s.order} "${s.title}" — phase ${s.phase} not paid for, stopping here (this is correct).`)
      await checkRefused('an unpaid phase refuses a play', () => learn.registerPlay(uid, String(s.id)), 'PHASE_LOCKED')
      break
    }

    console.log(`\n· Week ${s.order} — ${s.title}`)
    if (!check('  its video is open', !s.videoLocked, 'it is still locked')) break

    // Watching it: one play, then the 90% mark.
    await learn.registerPlay(uid, String(s.id))
    await learn.markVideoDone(uid, String(s.id))

    course = await learn.getCourse(uid, slug)
    let cur = course.sessions[i]
    const total = cur.questions.total

    if (total === 0) {
      check('  no-task week is complete once its video is watched', cur.completed)
      continue
    }
    check(`  task 1 of ${total} opened as soon as the video was watched`, cur.questions.current?.order === 1,
      `open task is ${cur.questions.current?.order ?? 'none'}`)

    // A later task must not be answerable out of turn. (Only the open one is
    // sent to the client, so reach past it in the DB the way a crafted request
    // would.)
    const laterQ = await (await import('./question.model.js')).Question
      .findOne({ session: s.id, order: total, active: true })
    if (laterQ && total > 1) {
      await checkRefused('  the last task refuses an answer while task 1 is open',
        () => learn.submitAnswer(uid, String(laterQ._id), 'jumping the queue'), 'LOCKED')
    }

    for (let n = 1; n <= total; n++) {
      const open = cur.questions.current
      if (!check(`  task ${n} is the open one`, open?.order === n, `open task is ${open?.order ?? 'none'}`)) break

      const qid = String(open.id)
      await learn.submitAnswer(uid, qid, `Automated flow check — week ${s.order}, task ${n}.`)
      tasksAnswered++

      await checkRefused(`  task ${n} refuses a second answer`,
        () => learn.submitAnswer(uid, qid, 'again'), 'LOCKED')

      course = await learn.getCourse(uid, slug)
      cur = course.sessions[i]
      check(`  task ${n} is now in the answered list`, cur.questions.answeredCount === n,
        `answered count is ${cur.questions.answeredCount}`)
    }

    check(`  week ${s.order} is complete after all ${total} tasks`, cur.completed && cur.questions.sessionCompleted)

    const next = course.sessions[i + 1]
    if (next && !next.phaseLocked) {
      check(`  finishing week ${s.order} opened week ${next.order}'s video`, !next.videoLocked,
        `it is still locked (unlocks at ${next.videoUnlockAt || 'never'})`)
    }
  }

  // --- the numbers the page and the report show --------------------------
  course = await learn.getCourse(uid, slug)
  const report = await learn.getReport(uid, slug)
  const record = await learn.courseRecord(uid, slug)
  check('progress percent matches the weeks completed',
    course.progress.percent === Math.round((course.progress.completed / course.progress.total) * 100))
  check('the report loads', !!report)
  // While the year is running the record only carries questions already
  // answered — the same drip the course page applies — so this count is exactly
  // what the walk wrote.
  const recorded = (record?.sessions || [])
    .reduce((n, s) => n + (s.questions || []).filter((q) => q.answer).length, 0)
  check('the record holds every answer that was written', recorded === tasksAnswered,
    `record has ${recorded}, we wrote ${tasksAnswered}`)

  // --- verdict -----------------------------------------------------------
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Weeks completed: ${course.progress.completed}/${course.progress.total}  ·  tasks answered: ${tasksAnswered}`)
  if (failures.length) {
    console.log(`\n✗ ${failures.length} check(s) FAILED (${passed} passed):`)
    for (const f2 of failures) console.log(`   · ${f2}`)
  } else {
    console.log(`\n✓ All ${passed} checks passed — the video → task → next-task → next-week chain works.`)
  }
  console.log(
    `\nThis account's "${slug}" is now full of test answers.` +
    `\nClear it with:  npm run reset:user -- ${email} ${slug}\n`
  )

  await mongoose.disconnect()
  process.exit(failures.length ? 1 : 0)
}

run().catch(async (err) => {
  console.error('\n✗ The walk stopped on an unexpected error:', err.message)
  console.error(err.stack)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
