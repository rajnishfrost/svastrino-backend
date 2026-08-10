import { SkillBuild } from '../skillbuild/skillbuild.model.js'
import { Package } from '../skillbuild/package.model.js'
import { Enrollment } from '../payments/enrollment.model.js'
import { Session } from './session.model.js'
import { Progress } from './progress.model.js'
import { Question } from './question.model.js'
import { Answer } from './answer.model.js'
import { LearnState } from './learnState.model.js'
import { nextIstMidnight, istDaysBetween } from '../../../utils/schedule.js'

const DAYS_PER_SESSION = 7 // 1 video + 6 daily questions = 7 days per session

const httpError = (message, status, code) => {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

/**
 * The highest package rank a user owns for a skill-build (or 0 if none).
 * Rank = Package.order (1 Discover, 2 Clarity, 3 Launch). Access is tier ≤ rank.
 */
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
 *     ones expose their prompt; future prompts stay hidden (just counted).
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
      const unlockAt = nextIstMidnight(prevSource)
      if (now.getTime() >= unlockAt.getTime()) {
        current = { id: q._id, order: q.order, prompt: q.prompt, unlockAt }
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

  return { sb, rank, packageName, sessions, learnState, progressMap, questionsBySession, answersByQid }
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
function videoUnlockAtFor(index, sessions, progressMap, startedAt) {
  if (!startedAt) return null // course not started
  if (index === 0) return startedAt // first video opens immediately on start
  const prev = sessions[index - 1]
  const prevProg = progressMap.get(String(prev._id))
  if (prevProg?.completed && prevProg.completedAt) return nextIstMidnight(prevProg.completedAt)
  return null // previous session not finished → next video not scheduled yet
}

/** Full course for the learning page — gated by tier AND the drip schedule. */
export async function getCourse(userId, slug) {
  const st = await loadState(userId, slug)
  const now = new Date()
  const startedAt = st.learnState?.startedAt || null

  const shaped = st.sessions.map((s, i) => {
    const prog = st.progressMap.get(String(s._id))
    const videoUnlockAt = videoUnlockAtFor(i, st.sessions, st.progressMap, startedAt)
    const videoLocked = !videoUnlockAt || now.getTime() < videoUnlockAt.getTime()
    const qs = computeQuestions(st.questionsBySession.get(String(s._id)) || [], st.answersByQid, prog?.videoDoneAt, now)

    return {
      id: s._id,
      order: s.order,
      tier: s.tier,
      title: s.title,
      description: s.description,
      videoUrl: s.videoUrl,
      durationMins: s.durationMins,
      captions: (s.captions || []).map((c) => ({ lang: c.lang, label: c.label, url: c.url })),
      worksheet: s.worksheet,
      notes: s.notes || [],
      videoLocked,
      videoUnlockAt,
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
export async function markVideoDone(userId, sessionId) {
  const st = await loadStateForSession(userId, sessionId)
  const { session, index } = st
  const videoUnlockAt = videoUnlockAtFor(index, st.sessions, st.progressMap, st.learnState?.startedAt)
  if (!videoUnlockAt || Date.now() < videoUnlockAt.getTime()) {
    throw httpError('This video is not open yet', 403, 'LOCKED')
  }

  const prog = st.progressMap.get(String(session._id))
  if (prog?.videoDoneAt) return { ok: true } // already anchored — keep the first watch

  await Progress.findOneAndUpdate(
    { user: userId, session: session._id },
    { $setOnInsert: { skillBuild: session.skillBuild }, $set: { videoDoneAt: new Date() } },
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
