import {
  ScholarshipCycle,
  ScholarshipQuestion,
  ScholarshipEnrollment,
  ScholarshipAttempt,
} from './scholarship.model.js'
import { Organisation } from '../organisation/organisation.model.js'
import { User } from '../credentials/credentials.model.js'
import { sendScholarshipResultEmail } from '../../../utils/mailer.js'
import { gradeAnswers } from '../../../utils/aiGrader.js'

const clampWords = (s, max) => {
  const words = String(s || '').trim().split(/\s+/).filter(Boolean)
  return words.length <= max ? String(s || '').trim() : words.slice(0, max).join(' ')
}

const httpError = (message, status, code) => {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

const MAX_WORDS_CAP = 1000

// ---- Cycles ------------------------------------------------------------------

export function windowState(cycle, now = new Date()) {
  const live = cycle.status === 'published' && cycle.active !== false
  const hasWindow = !!(cycle.startAt && cycle.endAt)
  const upcoming = hasWindow && now < cycle.startAt
  const ended = hasWindow && now > cycle.endAt
  const open = !!(live && hasWindow && !upcoming && !ended)
  return { hasWindow, upcoming, ended, open, live }
}

export const cycleDTO = (c, extra = {}) => ({
  id: c._id,
  organisation: c.organisation?._id || c.organisation || null,
  organisationName: c.organisation?.name || undefined,
  year: c.year,
  title: c.title,
  instructions: c.instructions || '',
  startAt: c.startAt || null,
  endAt: c.endAt || null,
  durationMins: c.durationMins,
  status: c.status,
  active: c.active !== false,
  declaredWinner: c.declaredWinner || null,
  winnerDeclaredAt: c.winnerDeclaredAt || null,
  ...windowState(c),
  ...extra,
})

/** Every cycle an organisation has ever run, newest year first. */
export async function listCycles(orgId) {
  return ScholarshipCycle.find({ organisation: orgId }).sort({ year: -1 })
}

/**
 * The cycle students can currently act on: the newest PUBLISHED one. Drafts are
 * invisible outside the portal, and archived years are history.
 */
export async function currentCycleFor(orgId) {
  return ScholarshipCycle.findOne({ organisation: orgId, status: 'published' }).sort({ year: -1 })
}

/** Create this organisation's cycle for a year. {org, year} is unique. */
export async function createCycle(orgId, { year, title, instructions } = {}, createdBy = null) {
  const y = Number(year) || new Date().getFullYear()
  if (y < 2000 || y > 2200) throw httpError('Enter a valid year', 400)
  const org = await Organisation.findById(orgId).select('name')
  if (!org) throw httpError('Organisation not found', 404)

  // Check first, and keep the 11000 catch as the race backstop. The unique
  // index alone isn't enough: Mongoose builds indexes in the background, so on a
  // fresh database a duplicate can slip through before the index exists.
  if (await ScholarshipCycle.exists({ organisation: orgId, year: y })) {
    throw httpError(`You already have a ${y} scholarship cycle`, 409, 'CYCLE_EXISTS')
  }

  try {
    return await ScholarshipCycle.create({
      organisation: orgId,
      year: y,
      title: String(title || '').trim() || `Nirmaan Scholarship ${y} — ${org.name}`,
      instructions: String(instructions || ''),
      createdBy,
    })
  } catch (e) {
    if (e?.code === 11000) throw httpError(`You already have a ${y} scholarship cycle`, 409, 'CYCLE_EXISTS')
    throw e
  }
}

/** Load a cycle, optionally asserting it belongs to `orgId`. */
export async function getCycle(cycleId, orgId = null) {
  const cycle = await ScholarshipCycle.findById(cycleId)
  if (!cycle) throw httpError('Scholarship cycle not found', 404)
  if (orgId && String(cycle.organisation) !== String(orgId)) {
    // Same 404 as a missing cycle — never confirm that someone else's id exists.
    throw httpError('Scholarship cycle not found', 404)
  }
  return cycle
}

export async function updateCycle(cycleId, body = {}, orgId = null) {
  const cycle = await getCycle(cycleId, orgId)
  if (cycle.status === 'archived') throw httpError('This cycle is archived and can no longer be edited', 400)

  if (body.title !== undefined) cycle.title = String(body.title).trim() || cycle.title
  if (body.instructions !== undefined) cycle.instructions = String(body.instructions)
  if (body.startAt !== undefined) cycle.startAt = body.startAt ? new Date(body.startAt) : null
  if (body.endAt !== undefined) cycle.endAt = body.endAt ? new Date(body.endAt) : null
  if (body.durationMins !== undefined) cycle.durationMins = Math.max(1, Number(body.durationMins) || 30)
  if (body.active !== undefined) cycle.active = !!body.active
  if (body.status !== undefined) {
    if (!['draft', 'published', 'archived'].includes(body.status)) throw httpError('Invalid status', 400)
    if (body.status === 'published') {
      // Publishing is what students see — refuse to publish something unusable.
      const qCount = await ScholarshipQuestion.countDocuments({ cycle: cycle._id, active: true })
      if (!qCount) throw httpError('Add at least one question before publishing', 400)
      if (!cycle.startAt || !cycle.endAt) throw httpError('Set the test start and end time before publishing', 400)
    }
    cycle.status = body.status
  }
  if (cycle.startAt && cycle.endAt && cycle.endAt <= cycle.startAt) {
    throw httpError('End time must be after start time', 400)
  }
  await cycle.save()
  return cycle
}

/** Delete a cycle. Only allowed while nobody has taken the test in it. */
export async function deleteCycle(cycleId, orgId = null) {
  const cycle = await getCycle(cycleId, orgId)
  const attempts = await ScholarshipAttempt.countDocuments({ cycle: cycle._id })
  if (attempts) throw httpError('Students have already attempted this cycle — archive it instead', 400)
  await ScholarshipQuestion.deleteMany({ cycle: cycle._id })
  await ScholarshipEnrollment.deleteMany({ cycle: cycle._id })
  await cycle.deleteOne()
}

// ---- Questions ---------------------------------------------------------------

/** Students never see `guidance` (the grading hint) — only the prompt + limit. */
export async function listQuestions(cycleId, { withGuidance = false } = {}) {
  const qs = await ScholarshipQuestion.find({ cycle: cycleId, active: true }).sort({ order: 1, createdAt: 1 })
  return withGuidance
    ? qs
    : qs.map((q) => ({ id: q._id, order: q.order, prompt: q.prompt, maxWords: q.maxWords || MAX_WORDS_CAP }))
}

/** Replace this cycle's whole question set (the editor sends the full list). */
export async function saveQuestions(cycleId, items, orgId = null) {
  const cycle = await getCycle(cycleId, orgId)
  if (cycle.status === 'archived') throw httpError('This cycle is archived and can no longer be edited', 400)
  if (!Array.isArray(items)) throw httpError('Questions must be a list', 400)

  // Changing the paper mid-flight would invalidate scores already awarded.
  const submitted = await ScholarshipAttempt.countDocuments({ cycle: cycle._id, status: 'submitted' })
  if (submitted) throw httpError('Students have already submitted — questions can no longer be changed', 400)

  const clean = items
    .map((q, i) => ({
      cycle: cycle._id,
      order: i + 1,
      prompt: String(q.prompt || '').trim(),
      guidance: String(q.guidance || '').trim(),
      maxWords: Math.min(MAX_WORDS_CAP, Math.max(20, Number(q.maxWords) || MAX_WORDS_CAP)),
      active: true,
    }))
    .filter((q) => q.prompt)

  await ScholarshipQuestion.deleteMany({ cycle: cycle._id })
  if (clean.length) await ScholarshipQuestion.insertMany(clean)
  return ScholarshipQuestion.find({ cycle: cycle._id, active: true }).sort({ order: 1 })
}

// ---- Enrolment ---------------------------------------------------------------

/**
 * A student enrolling themselves from the public page. They pick an approved
 * organisation; we put them into that organisation's current published cycle.
 */
export async function enroll(userId, { organisationId, studentClass, section, rollNo } = {}) {
  const org = await Organisation.findOne({ _id: organisationId, status: 'approved', active: true })
  if (!org) throw httpError('Pick a valid partner organisation', 400)

  const cycle = await currentCycleFor(org._id)
  if (!cycle) throw httpError(`${org.name} hasn’t opened its scholarship yet`, 400, 'NO_OPEN_CYCLE')
  if (windowState(cycle).ended) throw httpError('This scholarship has already closed', 400, 'CYCLE_ENDED')

  const cls = String(studentClass || '').trim()
  const roll = String(rollNo || '').trim()
  if (!cls) throw httpError('Your class is required', 400)
  if (!roll) throw httpError('Your roll number is required', 400)

  if (await ScholarshipEnrollment.exists({ user: userId, cycle: cycle._id })) {
    throw httpError('You are already enrolled for this scholarship', 409, 'ALREADY_ENROLLED')
  }

  const enrolment = await ScholarshipEnrollment.create({
    user: userId,
    cycle: cycle._id,
    organisation: org._id,
    studentClass: cls,
    section: String(section || '').trim(),
    rollNo: roll,
    source: 'self',
  })

  // A self-enrolling student with no organisation now has one — that's exactly
  // the "which organisation added me" link, just student-initiated.
  await User.updateOne(
    { _id: userId, organisation: null },
    { $set: { organisation: org._id, organisationRole: 'member' } }
  )

  return enrolment
}

/** Everyone enrolled in one cycle, with their attempt status. */
export async function listEnrollments(cycleId) {
  const enrollments = await ScholarshipEnrollment.find({ cycle: cycleId })
    .populate('user', 'name email phone')
    .sort({ createdAt: -1 })
    .limit(2000)

  const attempts = await ScholarshipAttempt.find({ cycle: cycleId })
  const attByUser = new Map(attempts.map((a) => [String(a.user), a]))

  return enrollments.map((e) => {
    const att = attByUser.get(String(e.user?._id))
    return {
      id: e._id,
      userId: e.user?._id || null,
      name: e.user?.name || '—',
      email: e.user?.email || '',
      phone: e.user?.phone || '',
      studentClass: e.studentClass || '',
      section: e.section || '',
      rollNo: e.rollNo || '',
      source: e.source || 'self',
      enrolledAt: e.enrolledAt || e.createdAt,
      attempt: att ? att.status : 'not_started',
      score: att?.status === 'submitted' ? att.score : null,
      total: att?.total ?? null,
    }
  })
}

/** Remove an enrolment (also clears the attempt so the student can re-enrol). */
export async function removeEnrollment(id, orgId = null) {
  const e = await ScholarshipEnrollment.findById(id)
  if (!e) throw httpError('Enrolment not found', 404)
  if (orgId && String(e.organisation) !== String(orgId)) throw httpError('Enrolment not found', 404)
  await ScholarshipAttempt.deleteOne({ user: e.user, cycle: e.cycle })
  await e.deleteOne()
}

// ---- The student's own view --------------------------------------------------

/**
 * Everything the signed-in student needs on the scholarship page: their live
 * cycle (if any), its window, their attempt, and their past years.
 */
export async function getMyScholarship(userId) {
  const enrollments = await ScholarshipEnrollment.find({ user: userId })
    .populate({ path: 'cycle' })
    .populate('organisation', 'name type branch city state code')
    .sort({ createdAt: -1 })

  const withCycle = enrollments.filter((e) => e.cycle)
  // The one they can still act on: newest published cycle they're enrolled in.
  const live = withCycle
    .filter((e) => e.cycle.status === 'published')
    .sort((a, b) => b.cycle.year - a.cycle.year)[0] || null

  const attempts = await ScholarshipAttempt.find({ user: userId })
  const attByCycle = new Map(attempts.map((a) => [String(a.cycle), a]))

  const history = withCycle
    .sort((a, b) => b.cycle.year - a.cycle.year)
    .map((e) => {
      const att = attByCycle.get(String(e.cycle._id))
      return {
        cycleId: e.cycle._id,
        year: e.cycle.year,
        title: e.cycle.title,
        status: e.cycle.status,
        organisation: e.organisation?.name || '—',
        attempt: att ? att.status : 'not_started',
        score: att?.status === 'submitted' ? att.score : null,
        total: att?.total ?? null,
        isWinner: !!e.cycle.declaredWinner && String(e.cycle.declaredWinner) === String(userId),
      }
    })

  if (!live) {
    return {
      enrolled: false,
      canEnroll: true,
      canStart: false,
      organisation: null,
      student: null,
      cycle: null,
      attempt: null,
      winner: null,
      isWinner: false,
      history,
    }
  }

  const attempt = attByCycle.get(String(live.cycle._id)) || null
  const w = windowState(live.cycle)
  const winner = await winnerInfo(live.cycle)

  return {
    enrolled: true,
    // Already in a live cycle — one scholarship at a time.
    canEnroll: false,
    canStart: w.open && attempt?.status !== 'submitted',
    organisation: live.organisation
      ? {
          id: live.organisation._id,
          name: live.organisation.name,
          type: live.organisation.type,
          branch: live.organisation.branch,
          city: live.organisation.city,
          state: live.organisation.state,
        }
      : null,
    student: { studentClass: live.studentClass, section: live.section, rollNo: live.rollNo },
    cycle: {
      id: live.cycle._id,
      year: live.cycle.year,
      title: live.cycle.title,
      instructions: live.cycle.instructions,
      startAt: live.cycle.startAt,
      endAt: live.cycle.endAt,
      durationMins: live.cycle.durationMins,
      ...w,
    },
    attempt: attempt
      ? {
          status: attempt.status,
          startedAt: attempt.startedAt,
          submittedAt: attempt.submittedAt,
          score: attempt.score,
          total: attempt.total,
        }
      : null,
    winner,
    isWinner: !!winner && winner.userId === String(userId),
    history,
  }
}

// ---- Test taking (timed, AI-graded) -----------------------------------------

function deadlineFor(cycle, startedAt) {
  const byDuration = new Date(startedAt.getTime() + cycle.durationMins * 60 * 1000)
  return cycle.endAt && cycle.endAt < byDuration ? cycle.endAt : byDuration
}

/** Which cycle is this student sitting? Their live enrolment, resolved server-side. */
async function liveEnrolment(userId) {
  const enrolments = await ScholarshipEnrollment.find({ user: userId }).populate('cycle')
  const live = enrolments
    .filter((e) => e.cycle && e.cycle.status === 'published')
    .sort((a, b) => b.cycle.year - a.cycle.year)[0]
  if (!live) throw httpError('Enrol for a scholarship first', 400, 'NOT_ENROLLED')
  return live
}

export async function startAttempt(userId) {
  const enrolment = await liveEnrolment(userId)
  const cycle = enrolment.cycle
  if (!windowState(cycle).open) throw httpError('The scholarship test is not open right now', 400, 'TEST_CLOSED')

  const questions = await listQuestions(cycle._id)
  if (!questions.length) throw httpError('The test has no questions yet', 400)

  let attempt = await ScholarshipAttempt.findOne({ user: userId, cycle: cycle._id })
  if (!attempt) {
    // Create-or-resume, race-safe: two near-simultaneous starts (e.g. React
    // StrictMode's double effect in dev, or a double-click) must not collide on
    // the unique {user, cycle} index — if we lose the race, fetch the winner.
    try {
      attempt = await ScholarshipAttempt.create({
        user: userId,
        cycle: cycle._id,
        organisation: enrolment.organisation,
        startedAt: new Date(),
        total: questions.length,
      })
    } catch (e) {
      if (e?.code === 11000) attempt = await ScholarshipAttempt.findOne({ user: userId, cycle: cycle._id })
      else throw e
    }
  }
  if (attempt?.status === 'submitted') throw httpError('You have already submitted the test', 409, 'ALREADY_SUBMITTED')

  return {
    attemptId: attempt._id,
    cycleId: cycle._id,
    title: cycle.title,
    instructions: cycle.instructions || '',
    startedAt: attempt.startedAt,
    deadline: deadlineFor(cycle, attempt.startedAt),
    questions,
  }
}

export async function submitAttempt(userId, answers) {
  const enrolment = await liveEnrolment(userId)
  const cycle = enrolment.cycle

  const attempt = await ScholarshipAttempt.findOne({ user: userId, cycle: cycle._id })
  if (!attempt) throw httpError('Start the test first', 400)
  if (attempt.status === 'submitted') throw httpError('You have already submitted the test', 409, 'ALREADY_SUBMITTED')

  const questions = await ScholarshipQuestion.find({ cycle: cycle._id, active: true }).sort({ order: 1, createdAt: 1 })

  // Map the student's typed answers onto the current questions (clamped to each
  // question's word limit as a safety net over the client-side cap).
  const textByQ = new Map(
    (Array.isArray(answers) ? answers : []).map((a) => [String(a.question), String(a.text || '')])
  )

  const gradeItems = questions.map((q) => ({
    id: String(q._id),
    question: q.prompt,
    guidance: q.guidance,
    answer: clampWords(textByQ.get(String(q._id)) || '', q.maxWords || MAX_WORDS_CAP),
  }))

  // AI grades every answer (1 mark each); score = sum of awards.
  const { marks, model } = await gradeAnswers(gradeItems)
  const awardById = new Map(marks.map((m) => [String(m.id), m]))

  let score = 0
  const stored = questions.map((q) => {
    const m = awardById.get(String(q._id))
    const awarded = m && Number(m.score) >= 1 ? 1 : 0
    score += awarded
    return {
      question: q._id,
      text: clampWords(textByQ.get(String(q._id)) || '', q.maxWords || MAX_WORDS_CAP),
      awarded,
      feedback: m?.feedback || '',
    }
  })

  attempt.answers = stored
  attempt.score = score
  attempt.total = questions.length
  attempt.gradedModel = model
  attempt.submittedAt = new Date()
  attempt.status = 'submitted'
  await attempt.save()
  return { score, total: questions.length }
}

// ---- Results -----------------------------------------------------------------

/** Ranked submitted attempts for ONE cycle (top score, earliest submit breaks ties). */
export async function leaderboard(cycleId) {
  const attempts = await ScholarshipAttempt.find({ cycle: cycleId, status: 'submitted' })
    .sort({ score: -1, submittedAt: 1 })
    .populate('user', 'name email')
    .limit(1000)

  const enrollments = await ScholarshipEnrollment.find({
    cycle: cycleId,
    user: { $in: attempts.map((a) => a.user?._id).filter(Boolean) },
  })
  const enrolByUser = new Map(enrollments.map((e) => [String(e.user), e]))

  return attempts.map((a, i) => {
    const e = enrolByUser.get(String(a.user?._id))
    return {
      rank: i + 1,
      userId: a.user?._id || null,
      name: a.user?.name || '—',
      email: a.user?.email || '',
      studentClass: e?.studentClass || '',
      section: e?.section || '',
      rollNo: e?.rollNo || '',
      score: a.score,
      total: a.total,
      submittedAt: a.submittedAt,
    }
  })
}

/** One student's full answer sheet — what the AI awarded, and why. */
export async function attemptDetail(cycleId, userId) {
  const attempt = await ScholarshipAttempt.findOne({ cycle: cycleId, user: userId }).populate('user', 'name email')
  if (!attempt) throw httpError('No attempt found for this student', 404)
  const questions = await ScholarshipQuestion.find({ cycle: cycleId }).sort({ order: 1 })
  const qById = new Map(questions.map((q) => [String(q._id), q]))
  return {
    student: { id: attempt.user?._id, name: attempt.user?.name || '—', email: attempt.user?.email || '' },
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    score: attempt.score,
    total: attempt.total,
    gradedModel: attempt.gradedModel || '',
    answers: attempt.answers.map((a) => ({
      prompt: qById.get(String(a.question))?.prompt || '(question removed)',
      text: a.text || '',
      awarded: a.awarded,
      feedback: a.feedback || '',
    })),
  }
}

/** Declare (or change) a cycle's winner and email every participant once. */
export async function declareWinner(cycleId, userId, orgId = null) {
  const cycle = await getCycle(cycleId, orgId)
  const prev = cycle.declaredWinner ? String(cycle.declaredWinner) : null

  if (!userId) {
    cycle.declaredWinner = null
    cycle.winnerDeclaredAt = null
    await cycle.save()
    return cycle
  }

  // The winner must actually have sat THIS cycle — not just be a valid user id.
  const attempt = await ScholarshipAttempt.findOne({ cycle: cycle._id, user: userId, status: 'submitted' })
  if (!attempt) throw httpError('That student has not submitted this cycle’s test', 400)

  cycle.declaredWinner = userId
  cycle.winnerDeclaredAt = new Date()
  await cycle.save()

  // Announce to everyone who took the test — but only when the winner actually
  // changes (so re-clicking "Declare" doesn't re-spam). Fire-and-forget.
  if (String(cycle.declaredWinner) !== prev) {
    dispatchResultEmails(cycle).catch((e) => console.error('✗ scholarship result emails failed:', e.message))
  }
  return cycle
}

/** Email every participant of a cycle: the winner wins, the rest get the result. */
async function dispatchResultEmails(cycle) {
  const info = await winnerInfo(cycle)
  if (!info) return
  const attempts = await ScholarshipAttempt.find({ cycle: cycle._id, status: 'submitted' }).populate('user', 'name email')
  for (const a of attempts) {
    const email = a.user?.email
    if (!email) continue
    try {
      await sendScholarshipResultEmail(email, {
        name: a.user.name,
        won: String(a.user._id) === String(cycle.declaredWinner),
        winnerName: info.name,
        institution: info.organisation,
      })
    } catch (e) {
      console.error(`✗ result email to ${email} failed:`, e.message)
    }
  }
}

/** The declared winner of one cycle (name + organisation + score), or null. */
export async function winnerInfo(cycle) {
  if (!cycle?.declaredWinner) return null
  const [user, org, attempt] = await Promise.all([
    User.findById(cycle.declaredWinner).select('name'),
    Organisation.findById(cycle.organisation).select('name city state'),
    ScholarshipAttempt.findOne({ cycle: cycle._id, user: cycle.declaredWinner }),
  ])
  if (!user) return null
  return {
    userId: String(cycle.declaredWinner),
    name: user.name || 'A student',
    organisation: org?.name || '',
    city: org?.city || '',
    year: cycle.year,
    score: attempt?.status === 'submitted' ? attempt.score : null,
    total: attempt?.total ?? null,
  }
}

/** Public: recently declared winners across every organisation. */
export async function publicWinners(limit = 12) {
  const cycles = await ScholarshipCycle.find({ declaredWinner: { $ne: null } })
    .sort({ winnerDeclaredAt: -1, year: -1 })
    .limit(limit)
  const winners = await Promise.all(cycles.map((c) => winnerInfo(c)))
  return winners.filter(Boolean)
}

// ---- Admin transparency ------------------------------------------------------

/**
 * Every cycle across every organisation, with live counts — the admin's single
 * view of what each partner is running. Counts are aggregated in two grouped
 * queries rather than N per cycle.
 */
export async function listAllCycles({ organisation, year, status } = {}) {
  const filter = {}
  if (organisation) filter.organisation = organisation
  if (year) filter.year = Number(year)
  if (status && ['draft', 'published', 'archived'].includes(status)) filter.status = status

  const cycles = await ScholarshipCycle.find(filter)
    .populate('organisation', 'name type city state status active')
    .populate('declaredWinner', 'name email')
    .sort({ year: -1, createdAt: -1 })
    .limit(500)

  const ids = cycles.map((c) => c._id)
  const [enrolAgg, submitAgg, questionAgg] = await Promise.all([
    ScholarshipEnrollment.aggregate([{ $match: { cycle: { $in: ids } } }, { $group: { _id: '$cycle', n: { $sum: 1 } } }]),
    ScholarshipAttempt.aggregate([
      { $match: { cycle: { $in: ids }, status: 'submitted' } },
      { $group: { _id: '$cycle', n: { $sum: 1 } } },
    ]),
    ScholarshipQuestion.aggregate([{ $match: { cycle: { $in: ids } } }, { $group: { _id: '$cycle', n: { $sum: 1 } } }]),
  ])
  const toMap = (rows) => new Map(rows.map((r) => [String(r._id), r.n]))
  const enrolled = toMap(enrolAgg)
  const submitted = toMap(submitAgg)
  const questions = toMap(questionAgg)

  return cycles.map((c) => ({
    ...cycleDTO(c),
    organisationName: c.organisation?.name || '—',
    organisationType: c.organisation?.type || '',
    organisationCity: c.organisation?.city || '',
    winnerName: c.declaredWinner?.name || '',
    winnerEmail: c.declaredWinner?.email || '',
    enrolled: enrolled.get(String(c._id)) || 0,
    submitted: submitted.get(String(c._id)) || 0,
    questions: questions.get(String(c._id)) || 0,
  }))
}

/** Programme-wide numbers for the admin scholarship dashboard. */
export async function adminOverview() {
  const [
    organisations,
    pendingOrganisations,
    activeOrganisations,
    cycles,
    liveCycles,
    enrolments,
    submitted,
    winners,
  ] = await Promise.all([
    Organisation.countDocuments({}),
    Organisation.countDocuments({ status: 'pending' }),
    Organisation.countDocuments({ status: 'approved', active: true }),
    ScholarshipCycle.countDocuments({}),
    ScholarshipCycle.countDocuments({ status: 'published', active: true }),
    ScholarshipEnrollment.countDocuments({}),
    ScholarshipAttempt.countDocuments({ status: 'submitted' }),
    ScholarshipCycle.countDocuments({ declaredWinner: { $ne: null } }),
  ])
  return {
    organisations,
    pendingOrganisations,
    activeOrganisations,
    cycles,
    liveCycles,
    enrolments,
    submitted,
    winners,
  }
}
