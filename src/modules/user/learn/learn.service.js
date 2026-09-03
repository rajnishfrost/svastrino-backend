import { SkillBuild } from '../skillbuild/skillbuild.model.js'
import { Package } from '../skillbuild/package.model.js'
import { Enrollment } from '../payments/enrollment.model.js'
import { Session } from './session.model.js'
import { Progress } from './progress.model.js'
import { Question } from './question.model.js'
import { Answer } from './answer.model.js'
import { LearnState } from './learnState.model.js'
import { courseAccess } from './courseAccess.js'
import { nextIstMidnight, istDaysBetween } from '../../../utils/schedule.js'
import { mediaUrl } from '../../../config/uploads.js'

const DAYS_PER_SESSION = 7 // 1 video + 6 daily questions = 7 days per session

/**
 * TEST MODE (`LEARN_TEST_MODE=1` in the server env). Off by default, and only a
 * server restart turns it on or off — nothing in the app can flip it.
 *
 * The course is paced by a calendar: a task opens at the IST midnight AFTER the
 * one before it was finished, so walking a student's whole journey takes as many
 * real days as the course has tasks. That is right for students and useless for
 * checking whether the chain actually works. With this on, "the next midnight"
 * becomes "right now", so finishing a task opens the next one immediately, and
 * finishing a week opens the next week's video immediately. The play limit is
 * lifted for the same reason, and the client is told (see `testMode` in
 * getCourse) so it unlocks forward-seeking on the video.
 *
 * Nothing else changes: the order of the chain, the "answer only the open
 * question" rule, phase payment and the one-year gate are all still enforced.
 * What you see in test mode is the real flow, only without the waiting.
 */
export const TEST_MODE = process.env.LEARN_TEST_MODE === '1' || process.env.LEARN_TEST_MODE === 'true'

if (TEST_MODE) {
  console.warn(
    '\n⚠️  LEARN_TEST_MODE is ON — the daily drip and the play limit are OFF.\n' +
    '    Every task opens the moment the one before it is finished.\n' +
    '    Remove LEARN_TEST_MODE from the env and restart before real students use this.\n'
  )
}

/**
 * When does the thing after `date` open? Normally the next IST midnight; in test
 * mode, straight away. Every drip date in this file goes through here, so the
 * two schedules can never drift apart.
 */
const unlockAfter = (date) => (TEST_MODE ? new Date(date) : nextIstMidnight(date))

const httpError = (message, status, code) => {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

/**
 * The gate on the one-year rule. Every door that hands out course content goes
 * through this one check — opening the course, starting it, playing a video,
 * marking a video watched, answering a question — because a door left unguarded
 * is a way back into a course the student no longer has.
 */
async function assertActiveCourse(userId, slug) {
  const access = await courseAccess(userId, slug)
  if (access.state === 'active') return access
  throw httpError(
    access.trial
      ? 'Your free trial week is over, so the videos and tasks are closed. Everything you wrote is saved and waiting — pick a package and you carry on from Week 2.'
      : 'Your one year with this course is over, so the videos and tasks are closed. You can still download your work. If you would like more time, please write to us and we will help.',
    403,
    'COURSE_EXPIRED',
  )
}

/**
 * The highest package rank a user owns for a skill-build (or 0 if none).
 * Rank = Package.order (1 Discover, 2 Clarity, 3 Launch). Access is tier ≤ rank.
 */
/** A video may be started this many times before it stops playing (anti-piracy). */
export const PLAY_LIMIT = TEST_MODE ? Number.MAX_SAFE_INTEGER : 5

/**
 * The course is cut into equal blocks of weeks — "phases". A pay-as-you-use
 * student buys them one at a time; a pay-once student gets them all.
 * Phase numbers are 1-based, and the last phase absorbs any remainder.
 */
export function phaseOfSession(order, totalWeeks, phases) {
  if (!phases || phases < 2) return 1

  // Keyed on the session's own number, not its position in the list.
  //
  // The introduction sits at order 0: it has no tasks, belongs to no phase, and
  // is not one of the 24 weeks the course is sold as. Counting it would push
  // every boundary along — six phases over 25 sessions comes out as five of
  // five with the sixth empty, so a student who had paid for phase 2 would find
  // weeks 5-9 in it instead of 5-8.
  if (!order) return 1

  const perPhase = Math.ceil(totalWeeks / phases)
  return Math.min(phases, Math.floor((order - 1) / perPhase) + 1)
}

/** How many real weeks a session list holds — the introduction is not one. */
export function weekCount(sessions) {
  return sessions.filter((s) => s.order > 0).length || sessions.length
}

/** The strongest active enrollment's phase access for this course. */
async function phaseAccess(userId, skillBuildSlug) {
  const enrollments = await Enrollment.find({
    user: userId, product: skillBuildSlug, status: 'active',
  })
  if (!enrollments.length) return { unlocked: 0, total: 1, paymentMode: 'one-time' }
  // Take the most generous access the student holds.
  const best = enrollments.reduce((a, b) => (b.phasesUnlocked > a.phasesUnlocked ? b : a))
  return {
    unlocked: best.phasesUnlocked ?? 1,
    total: best.phasesTotal ?? 1,
    paymentMode: best.paymentMode || 'one-time',
  }
}

async function userRank(userId, skillBuildSlug) {
  const enrollments = await Enrollment.find({ user: userId, product: skillBuildSlug, status: 'active' })
  if (!enrollments.length) return { rank: 0, packageName: null }
  const skus = enrollments.map((e) => e.packageId)
  const packages = await Package.find({ sku: { $in: skus } })
  let rank = 0
  let packageName = null
  for (const p of packages) {
    if (p.order > rank) { rank = p.order; packageName = p.name }
  }
  return { rank, packageName }
}

/**
 * Compute one session's question drip state for a user.
 *   - Q1 opens the IST-midnight after the video was watched (videoDoneAt).
 *   - Each next question opens the IST-midnight after the previous is answered.
 *   - Only the CURRENT (unlocked + unanswered) question and already-answered
 *     ones expose their prompt and its worked example; future prompts stay
 *     hidden (just counted).
 */
function computeQuestions(questions, answersByQid, videoDoneAt, now) {
  const total = questions.length
  const answered = []
  let current = null
  let nextUnlockAt = null

  if (videoDoneAt && total > 0) {
    let prevSource = videoDoneAt
    for (const q of questions) {
      const ans = answersByQid.get(String(q._id))
      if (ans) {
        answered.push({ order: q.order, prompt: q.prompt, text: ans.text, submittedAt: ans.submittedAt })
        prevSource = ans.submittedAt
        continue
      }
      // First unanswered question — it is either open now or waiting for its day.
      const unlockAt = unlockAfter(prevSource)
      if (now.getTime() >= unlockAt.getTime()) {
        current = { id: q._id, order: q.order, prompt: q.prompt, placeholder: q.placeholder || '', unlockAt }
      } else {
        nextUnlockAt = unlockAt
      }
      break
    }
  }

  const answeredCount = answered.length
  return {
    total,
    answeredCount,
    sessionCompleted: total > 0 && answeredCount === total,
    current,        // { id, order, prompt, unlockAt } or null
    nextUnlockAt,   // Date the next question opens (when current is null but not done)
    answered,       // past answers (order, prompt, text, submittedAt)
  }
}

/** Load everything needed to reason about a user's course in one place. */
async function loadState(userId, slug) {
  const sb = await SkillBuild.findOne({ slug, active: true })
  if (!sb) throw httpError('Course not found', 404)

  const { rank, packageName } = await userRank(userId, slug)
  if (rank === 0) throw httpError('You need to enrol in this course first.', 403, 'NOT_ENROLLED')

  const sessions = await Session.find({ skillBuild: sb._id, active: true, tier: { $lte: rank } }).sort({ order: 1 })
  const sessionIds = sessions.map((s) => s._id)

  const [learnState, progresses, questions, answers] = await Promise.all([
    LearnState.findOne({ user: userId, skillBuild: sb._id }),
    Progress.find({ user: userId, skillBuild: sb._id }),
    Question.find({ session: { $in: sessionIds }, active: true }).sort({ order: 1 }),
    Answer.find({ user: userId, session: { $in: sessionIds } }),
  ])

  const progressMap = new Map(progresses.map((p) => [String(p.session), p]))
  const questionsBySession = new Map()
  for (const q of questions) {
    const k = String(q.session)
    if (!questionsBySession.has(k)) questionsBySession.set(k, [])
    questionsBySession.get(k).push(q)
  }
  const answersByQid = new Map(answers.map((a) => [String(a.question), a]))

  const phases = await phaseAccess(userId, slug)

  return { sb, rank, packageName, sessions, learnState, progressMap, questionsBySession, answersByQid, phases }
}

/** loadState + locate a specific session (with its index) for the given user. */
async function loadStateForSession(userId, sessionId) {
  const session = await Session.findById(sessionId)
  if (!session) throw httpError('Session not found', 404)
  const sb = await SkillBuild.findById(session.skillBuild)
  const st = await loadState(userId, sb.slug)
  const index = st.sessions.findIndex((s) => String(s._id) === String(session._id))
  if (index === -1) throw httpError('You do not have access to this session', 403)
  return { ...st, session: st.sessions[index], index }
}

/** When does a given session's VIDEO open? (chained, sequential, IST-midnight). */
function videoUnlockAtFor(index, sessions, progressMap, startedAt, questionsBySession) {
  if (!startedAt) return null // course not started
  if (index === 0) return startedAt // first video opens immediately on start
  const prev = sessions[index - 1]
  const prevProg = progressMap.get(String(prev._id))

  // A session with no tasks — the introduction, and the closing week — has
  // nothing to answer, so it can never be "completed" the way the rest are.
  // Waiting for that would leave the next video shut for good. Watching it
  // through opens the next one immediately: the midnight wait exists to pace
  // six days of daily tasks, and there are none to pace.
  const prevTasks = questionsBySession?.get(String(prev._id))?.length || 0
  if (!prevTasks) return prevProg?.videoDoneAt || null

  if (prevProg?.completed && prevProg.completedAt) return unlockAfter(prevProg.completedAt)
  return null // previous session not finished → next video not scheduled yet
}

/**
 * How one session looks once the course year is over. It is the same shape a
 * locked phase already sends — nothing playable, no questions, no unlock dates
 * — so the page renders it without needing to learn anything new. What the
 * student already achieved is left in place, because that part is theirs.
 */
function closedSession(session, prog, phase, phaseLocked, st) {
  const questions = st.questionsBySession.get(String(session._id)) || []
  const answeredCount = questions.filter((q) => st.answersByQid.has(String(q._id))).length
  return {
    id: session._id,
    order: session.order,
    tier: session.tier,
    title: session.title,
    description: session.description,
    videoUrl: '',
    durationMins: session.durationMins,
    captions: [],
    notes: [],
    phase,
    phaseLocked,
    videoLocked: true,
    videoUnlockAt: null,
    plays: prog?.plays || 0,
    playsLeft: 0,
    playLimitReached: true,
    videoDone: !!prog?.videoDoneAt,
    completed: !!prog?.completed,
    completedAt: prog?.completedAt || null,
    questions: {
      total: questions.length,
      answeredCount,
      sessionCompleted: questions.length > 0 && answeredCount === questions.length,
      current: null,
      nextUnlockAt: null,
      answered: [],
    },
  }
}

/** Full course for the learning page — gated by tier AND the drip schedule. */
export async function getCourse(userId, slug) {
  // The year is read before any content is shaped. Once it is over the course
  // still loads, because the student needs this page to reach their record and
  // to ask for more time — but every session comes back closed below.
  const access = await courseAccess(userId, slug)
  const st = await loadState(userId, slug)
  const now = new Date()
  const startedAt = st.learnState?.startedAt || null
  const closed = access.state !== 'active'

  const shaped = st.sessions.map((s, i) => {
    const prog = st.progressMap.get(String(s._id))
    // Two separate gates. The drip clock decides WHEN a session opens; the phase
    // decides WHETHER it has been paid for at all. A phase the student has not
    // bought yet stays shut no matter how far the clock has run.
    const phase = phaseOfSession(s.order, weekCount(st.sessions), st.phases.total)
    const phaseLocked = phase > st.phases.unlocked
    if (closed) return closedSession(s, prog, phase, phaseLocked, st)
    const videoUnlockAt = videoUnlockAtFor(i, st.sessions, st.progressMap, startedAt, st.questionsBySession)
    const plays = prog?.plays || 0
    const videoLocked = phaseLocked || !videoUnlockAt || now.getTime() < videoUnlockAt.getTime()
    const qs = phaseLocked
      ? { current: null, nextUnlockAt: null, answered: [], total: (st.questionsBySession.get(String(s._id)) || []).length }
      : computeQuestions(st.questionsBySession.get(String(s._id)) || [], st.answersByQid, prog?.videoDoneAt, now)

    return {
      id: s._id,
      order: s.order,
      tier: s.tier,
      title: s.title,
      description: s.description,
      videoUrl: mediaUrl(s.videoUrl),
      durationMins: s.durationMins,
      captions: (s.captions || []).map((c) => ({ lang: c.lang, label: c.label, url: c.url })),
      // The worksheet is NOT sent. It holds every one of the week's six tasks,
      // and handing that over would undo the drip the line below is careful to
      // keep: computeQuestions deliberately withholds a prompt the student has
      // not reached, so sending the same text in another field just moved the
      // whole week into the Network tab. Admins still get it (manage.controller).
      notes: s.notes || [],
      phase,
      phaseLocked,          // true = this phase has not been paid for yet
      videoLocked,
      videoUnlockAt: phaseLocked ? null : videoUnlockAt,
      plays,
      playsLeft: Math.max(0, PLAY_LIMIT - plays),
      playLimitReached: plays >= PLAY_LIMIT,
      videoDone: !!prog?.videoDoneAt, // controls seek-unlock on the client
      completed: !!prog?.completed,   // session fully done (all questions answered)
      completedAt: prog?.completedAt || null,
      questions: qs,
    }
  })

  const completedCount = shaped.filter((s) => s.completed).length
  return {
    skillBuild: { slug: st.sb.slug, name: st.sb.name },
    packageName: st.packageName,
    // The one-year rule, so the page can show the right screen: how many days
    // are left, or what is still possible now that the year has gone by.
    access,
    phases: {
      unlocked: st.phases.unlocked,
      total: st.phases.total,
      paymentMode: st.phases.paymentMode,
      // What the student must buy next, if anything.
      nextPhase: st.phases.unlocked < st.phases.total ? st.phases.unlocked + 1 : null,
    },
    playLimit: PLAY_LIMIT,
    // Told to the client so it can drop the first-watch seek lock and show the
    // "test mode" banner. It is never true unless the server was started with
    // LEARN_TEST_MODE set.
    testMode: TEST_MODE,
    rank: st.rank,
    started: !!startedAt,
    startedAt,
    sessions: shaped,
    progress: {
      completed: completedCount,
      total: shaped.length,
      percent: shaped.length ? Math.round((completedCount / shaped.length) * 100) : 0,
    },
  }
}

/** Begin the course (idempotent). Sets the schedule anchor; Video 1 opens now. */
export async function startCourse(userId, slug) {
  await assertActiveCourse(userId, slug)   // the year must still be running
  const st = await loadState(userId, slug) // also enforces enrolment
  if (!st.learnState) {
    await LearnState.create({ user: userId, skillBuild: st.sb._id, slug, startedAt: new Date() })
  }
  return getCourse(userId, slug)
}

/**
 * Record that the video passed 90% (first watch only — the first time is the
 * schedule anchor for Q1 and permanently unlocks seeking on this video).
 */
/**
 * Count one play of a video and say how many are left. Called by the player the
 * moment playback actually starts, NOT on page load — otherwise simply opening
 * the page would burn a play. Refuses once the limit is spent, and refuses for
 * a phase the student has not paid for.
 */
export async function registerPlay(userId, sessionId) {
  const st = await loadStateForSession(userId, sessionId)
  await assertActiveCourse(userId, st.sb.slug)
  const phase = phaseOfSession(st.session.order, weekCount(st.sessions), st.phases.total)
  if (phase > st.phases.unlocked) {
    throw httpError('Pay for this phase to open its videos.', 403, 'PHASE_LOCKED')
  }

  const existing = await Progress.findOne({ user: userId, session: sessionId })
  const plays = existing?.plays || 0
  if (plays >= PLAY_LIMIT) {
    throw httpError(
      `You have watched this video the maximum of ${PLAY_LIMIT} times.`,
      403,
      'PLAY_LIMIT_REACHED'
    )
  }

  const prog = await Progress.findOneAndUpdate(
    { user: userId, session: sessionId },
    { $inc: { plays: 1 }, $setOnInsert: { skillBuild: st.sb._id } },
    { new: true, upsert: true }
  )
  return {
    plays: prog.plays,
    playsLeft: Math.max(0, PLAY_LIMIT - prog.plays),
    playLimit: PLAY_LIMIT,
  }
}

export async function markVideoDone(userId, sessionId) {
  const st = await loadStateForSession(userId, sessionId)
  await assertActiveCourse(userId, st.sb.slug)
  const { session, index } = st
  const videoUnlockAt = videoUnlockAtFor(index, st.sessions, st.progressMap, st.learnState?.startedAt, st.questionsBySession)
  if (!videoUnlockAt || Date.now() < videoUnlockAt.getTime()) {
    throw httpError('This video is not open yet', 403, 'LOCKED')
  }

  const prog = st.progressMap.get(String(session._id))
  if (prog?.videoDoneAt) return { ok: true } // already anchored — keep the first watch

  // A session with no tasks is finished the moment its video is — there is
  // nothing else in it. Marking it complete keeps the progress bar and the
  // report honest; without this the introduction would sit at "started" for
  // the rest of the course.
  const taskCount = st.questionsBySession?.get(String(session._id))?.length || 0
  const now = new Date()
  const patch = taskCount ? { videoDoneAt: now } : { videoDoneAt: now, completed: true, completedAt: now }

  await Progress.findOneAndUpdate(
    { user: userId, session: session._id },
    { $setOnInsert: { skillBuild: session.skillBuild }, $set: patch },
    { upsert: true },
  )
  return { ok: true }
}

/** Submit the free-text answer to the currently-open question of its session. */
export async function submitAnswer(userId, questionId, text) {
  const body = String(text || '').trim()
  if (!body) throw httpError('Please type an answer before submitting', 400)

  const question = await Question.findById(questionId)
  if (!question || !question.active) throw httpError('Question not found', 404)

  const st = await loadStateForSession(userId, String(question.session))
  await assertActiveCourse(userId, st.sb.slug)
  const { session } = st

  const prog = st.progressMap.get(String(session._id))
  const qs = computeQuestions(st.questionsBySession.get(String(session._id)) || [], st.answersByQid, prog?.videoDoneAt, new Date())

  // Must be exactly the current open question (guards locked / out-of-order / repeat).
  if (!qs.current || String(qs.current.id) !== String(question._id)) {
    throw httpError('This question is not open yet', 403, 'LOCKED')
  }

  await Answer.create({
    user: userId,
    question: question._id,
    session: session._id,
    skillBuild: session.skillBuild,
    order: question.order,
    text: body,
    submittedAt: new Date(),
  })

  // Was that the last question? → session fully complete (unlocks the next video).
  const answeredNow = await Answer.countDocuments({ user: userId, session: session._id })
  if (answeredNow >= qs.total) {
    await Progress.findOneAndUpdate(
      { user: userId, session: session._id },
      { $setOnInsert: { skillBuild: session.skillBuild }, $set: { completed: true, completedAt: new Date() } },
      { upsert: true },
    )
  }
  return { ok: true, sessionCompleted: answeredNow >= qs.total }
}

/**
 * THE one generalized "what is due today" calculation — used by the report (the
 * page's status line) AND the daily reminder e-mail, so the two can never
 * disagree. Works off a getCourse() payload.
 */
export function todayTask(course) {
  // Once the year is over nothing is due any more. Saying so here keeps the
  // page honest — and, because the daily reminder reads the same line, it also
  // stops us nudging a student about a video that will never open again.
  if (course.access && course.access.state !== 'active') {
    return { type: 'closed', label: 'Your one year with this course is over. You can still download your work.' }
  }

  const s = course.sessions.find((x) => !x.completed)
  if (!s) return { type: 'done', label: 'Course complete — great work!' }

  if (s.videoLocked) {
    return {
      type: 'waiting',
      label: `Next video opens soon: “${s.title}”`,
      unlockAt: s.videoUnlockAt || null,
      sessionTitle: s.title,
    }
  }
  if (!s.videoDone) {
    return { type: 'video', label: `A new video is open for you: “${s.title}”`, sessionTitle: s.title }
  }
  if (s.questions?.current) {
    return {
      type: 'question',
      label: `Question ${s.questions.current.order} of ${s.questions.total} is open — “${s.title}”`,
      sessionTitle: s.title,
    }
  }
  return {
    type: 'waiting',
    label: `Nothing due today — the next step opens tomorrow (“${s.title}”)`,
    unlockAt: s.questions?.nextUnlockAt || null,
    sessionTitle: s.title,
  }
}

/**
 * Completion report: auto target = (accessible sessions × 7 days) vs actual
 * days taken. No penalty — just the record of how long the student took.
 */
export async function getReport(userId, slug) {
  const course = await getCourse(userId, slug)
  const startedAt = course.startedAt
  const totalSessions = course.sessions.length
  const targetDays = totalSessions * DAYS_PER_SESSION
  const completedCount = course.progress.completed
  const allDone = totalSessions > 0 && completedCount === totalSessions

  let lastCompletedAt = null
  for (const s of course.sessions) {
    if (s.completedAt && (!lastCompletedAt || s.completedAt > lastCompletedAt)) lastCompletedAt = s.completedAt
  }

  const now = new Date()
  // Day 1 = the start day, so add 1 to the difference.
  const daysElapsed = startedAt ? istDaysBetween(new Date(startedAt), allDone ? lastCompletedAt : now) + 1 : 0
  const actualDays = allDone && lastCompletedAt ? istDaysBetween(new Date(startedAt), lastCompletedAt) + 1 : null

  // Day-level pace drift. Ideal = one step per day (day 1 video, day 2 Q1, …,
  // day 7 Q6 → next session). Steps actually done = 7 per finished session +
  // video/answers in the current one. If today's step is still OPEN (they can
  // still do it), today doesn't count against them yet.
  const task = startedAt ? todayTask(course) : null
  const current = course.sessions.find((s) => !s.completed)
  const stepsDone =
    completedCount * DAYS_PER_SESSION +
    (current ? (current.videoDone ? 1 : 0) + (current.questions?.answeredCount || 0) : 0)
  const graceToday = task && (task.type === 'video' || task.type === 'question') ? 1 : 0
  const behindDays = startedAt && !allDone
    ? Math.max(0, Math.min(daysElapsed, totalSessions * DAYS_PER_SESSION) - stepsDone - graceToday)
    : 0

  return {
    started: !!startedAt,
    startedAt,
    totalSessions,
    completedSessions: completedCount,
    targetDays,
    daysElapsed,
    actualDays,          // filled once the whole course is done
    finishedAt: allDone ? lastCompletedAt : null,
    behindDays,
    onTrack: behindDays === 0,
    // Honest projection: the chain can't be doubled up, so drift carries forward.
    estimatedDays: allDone ? actualDays : targetDays + behindDays,
    // The single source of truth for "what should I do today" — the same value
    // the daily reminder e-mail uses.
    todayTask: task,
  }
}

/**
 * The student's own record of the course: the questions they were asked, the
 * answers they wrote in their own words, and the dates around them. The client
 * prints this as the branded PDF.
 *
 * This is the only place the three-year retention rule lives. The course itself
 * closes after a year, but the work is theirs to keep for three years more —
 * and after that, all that honestly remains is which course they took.
 */
export async function courseRecord(userId, slug) {
  const access = await courseAccess(userId, slug)
  if (access.state === 'none') {
    throw httpError('We could not find this course in your account.', 404, 'NOT_ENROLLED')
  }

  const st = await loadState(userId, slug)
  const startedAt = st.learnState?.startedAt || null

  // A course counts as finished only when every session the student has is
  // done, so an unfinished course carries no finish date. This is the same rule
  // the progress report uses, so the two can never tell different stories.
  let lastCompletedAt = null
  let sessionsCompleted = 0
  for (const s of st.sessions) {
    const prog = st.progressMap.get(String(s._id))
    if (!prog?.completed) continue
    sessionsCompleted += 1
    if (prog.completedAt && (!lastCompletedAt || prog.completedAt > lastCompletedAt)) {
      lastCompletedAt = prog.completedAt
    }
  }
  const sessionsTotal = st.sessions.length
  const completedAt = sessionsTotal > 0 && sessionsCompleted === sessionsTotal ? lastCompletedAt : null

  // Three years after the course expired, the work goes as well. What is left
  // is which course they did and when — no questions and no answers.
  if (access.state === 'archived') {
    return {
      course: { name: st.sb.name, slug: st.sb.slug },
      enrolledAt: access.enrolledAt,
      startedAt,
      completedAt,
      expiresAt: access.expiresAt,
      recordUntil: access.recordUntil,
      downloadable: false,
      sessions: [],
    }
  }

  // Is the year still running? A record asked for mid-course is a second door
  // onto the same questions, so while the course is live it opens only as wide
  // as the course page does — see the drip note below.
  const live = access.state === 'active'

  const sessions = st.sessions.map((s, i) => {
    const prog = st.progressMap.get(String(s._id))
    // The same phase paywall the course page applies. A phase the student has
    // not bought is listed by title only: printing its questions here would
    // hand over the part of the course they have not paid for, which is exactly
    // what the course page refuses to do. This is not the same as a session
    // they simply have not reached yet — that one keeps its questions on
    // purpose, so please do not fold the two cases back together.
    const phaseLocked = phaseOfSession(s.order, weekCount(st.sessions), st.phases.total) > st.phases.unlocked
    const held = (st.questionsBySession.get(String(s._id)) || [])
      .slice()
      .sort((a, b) => a.order - b.order)
    // And the second gate the course page applies is the daily drip: a question
    // the student has not reached yet is not shown to them. That still holds
    // while the year is running, so a live course records only the questions
    // they have already answered — otherwise pressing Download on day one would
    // read the whole course ahead of its own schedule. Once the year is over
    // there is nothing left to run ahead of, so the questions they never got to
    // come back with the rest and the record shows the gaps.
    const questions = phaseLocked
      ? []
      : live
        ? held.filter((q) => st.answersByQid.has(String(q._id)))
        : held
    return {
      index: s.order, // the session number the student saw on the course page
      title: s.title,
      phaseLocked, // true = never paid for, so it carries no questions
      // How many questions the session really holds, so a document can say why
      // it is printing fewer of them rather than imply there were none.
      questionsTotal: held.length,
      videoWatchedAt: prog?.videoDoneAt || null,
      completedAt: prog?.completedAt || null,
      // A session the student never reached is still listed here, with its
      // questions and no answers. An honest record shows the gaps too.
      questions: questions.map((q) => {
        const answer = st.answersByQid.get(String(q._id))
        return {
          order: q.order,
          question: q.prompt,
          answer: answer?.text || null,
          answeredAt: answer?.submittedAt || null,
        }
      }),
    }
  })

  return {
    course: { name: st.sb.name, slug: st.sb.slug },
    packageName: st.packageName,
    enrolledAt: access.enrolledAt,
    startedAt,
    completedAt,
    expiresAt: access.expiresAt,
    recordUntil: access.recordUntil,
    // Whole days from the day they started to the day they finished.
    daysTaken: startedAt && completedAt
      ? istDaysBetween(new Date(startedAt), new Date(completedAt))
      : null,
    sessionsTotal,
    sessionsCompleted,
    downloadable: true,
    sessions,
  }
}

/**
 * Lightweight progress summary for a user's enrollment (used on the dashboard).
 * Counts sessions accessible at `rank` and how many are fully completed.
 */
export async function courseProgress(userId, skillBuildId, rank) {
  const total = await Session.countDocuments({ skillBuild: skillBuildId, active: true, tier: { $lte: rank } })
  if (!total) return { completed: 0, total: 0, percent: 0 }
  const completed = await Progress.countDocuments({ user: userId, skillBuild: skillBuildId, completed: true })
  const capped = Math.min(completed, total)
  return { completed: capped, total, percent: Math.round((capped / total) * 100) }
}

/** Progress for one enrollment (resolves its skill-build + package rank first). */
export async function enrollmentProgress(userId, enrollment) {
  const sb = await SkillBuild.findOne({ slug: enrollment.product })
  if (!sb) return { completed: 0, total: 0, percent: 0 }
  const pkg = await Package.findOne({ sku: enrollment.packageId })
  return courseProgress(userId, sb._id, pkg?.order || 1)
}
