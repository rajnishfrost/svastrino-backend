import {
  Institution,
  ScholarshipTest,
  ScholarshipQuestion,
  ScholarshipEnrollment,
  ScholarshipAttempt,
} from './scholarship.model.js'
import { User } from '../credentials/credentials.model.js'
import { sendScholarshipStatusEmail, sendScholarshipResultEmail } from '../../../utils/mailer.js'
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

const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

// ---- Institution partner applications ---------------------------------------

/** Public form submission. One application per client IP. */
export async function submitInstitution(body, ip) {
  const name = String(body.name || '').trim()
  const email = String(body.email || '').trim().toLowerCase()
  const type = body.type === 'college' ? 'college' : 'school'
  if (!name) throw httpError('Institution name is required', 400)
  if (!isEmail(email)) throw httpError('Enter a valid email', 400)

  // One submission per IP (trust-proxy is on, so req.ip is the real client).
  if (ip && (await Institution.findOne({ submittedIp: ip }))) {
    throw httpError('A request has already been submitted from this network.', 409, 'IP_ALREADY_SUBMITTED')
  }

  const inst = await Institution.create({
    name,
    type,
    branch: String(body.branch || '').trim(),
    city: String(body.city || '').trim(),
    state: String(body.state || '').trim(),
    contactPerson: String(body.contactPerson || '').trim(),
    phone: String(body.phone || '').trim(),
    email,
    submittedIp: ip || '',
    status: 'pending',
  })
  return inst
}

export async function listInstitutions({ status } = {}) {
  const filter = status && ['pending', 'approved', 'rejected'].includes(status) ? { status } : {}
  // A→Z by name (case-insensitive), then branch.
  return Institution.find(filter).collation({ locale: 'en', strength: 2 }).sort({ name: 1, branch: 1 }).limit(500)
}

/** Approve / reject an application and email the applicant their status. */
export async function reviewInstitution(adminId, id, { status, reason }) {
  if (!['approved', 'rejected'].includes(status)) throw httpError('Invalid status', 400)
  const inst = await Institution.findById(id)
  if (!inst) throw httpError('Institution not found', 404)

  inst.status = status
  inst.rejectionReason = status === 'rejected' ? String(reason || '').trim() : ''
  inst.reviewedBy = adminId
  inst.reviewedAt = new Date()
  await inst.save()

  // Fire-and-forget — a mail failure must never fail the review.
  sendScholarshipStatusEmail(inst.email, {
    name: inst.contactPerson || inst.name,
    institution: inst.name,
    status,
    reason: inst.rejectionReason,
  }).catch((e) => console.error('✗ scholarship status email failed:', e.message))

  return inst
}

/** Approved institutions only — powers the student enrolment dropdown. */
export async function approvedInstitutions() {
  return Institution.find({ status: 'approved' })
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1, branch: 1 })
    .select('name type branch city state')
}

// ---- Test config + questions ------------------------------------------------

/** The single test config (created on first access). */
export async function getTest() {
  let test = await ScholarshipTest.findOne({ key: 'nirmaan' })
  if (!test) test = await ScholarshipTest.create({ key: 'nirmaan' })
  return test
}

export async function updateTest(body) {
  const test = await getTest()
  if (body.title !== undefined) test.title = String(body.title).trim() || test.title
  if (body.instructions !== undefined) test.instructions = String(body.instructions)
  if (body.startAt !== undefined) test.startAt = body.startAt ? new Date(body.startAt) : null
  if (body.endAt !== undefined) test.endAt = body.endAt ? new Date(body.endAt) : null
  if (body.durationMins !== undefined) test.durationMins = Math.max(1, Number(body.durationMins) || 30)
  if (body.active !== undefined) test.active = !!body.active
  if (test.startAt && test.endAt && test.endAt <= test.startAt) {
    throw httpError('End time must be after start time', 400)
  }
  await test.save()
  return test
}

const MAX_WORDS_CAP = 1000

export async function listQuestions({ withAnswers = false } = {}) {
  const qs = await ScholarshipQuestion.find({ active: true }).sort({ order: 1, createdAt: 1 })
  // Students never see `guidance` (the grading hint) — only the prompt + limit.
  return withAnswers
    ? qs
    : qs.map((q) => ({ id: q._id, order: q.order, prompt: q.prompt, maxWords: q.maxWords || MAX_WORDS_CAP }))
}

/** Replace the whole question set (admin editor sends the full list). */
export async function saveQuestions(items) {
  if (!Array.isArray(items)) throw httpError('Questions must be a list', 400)
  const clean = items
    .map((q, i) => {
      const prompt = String(q.prompt || '').trim()
      const guidance = String(q.guidance || '').trim()
      let maxWords = Number(q.maxWords) || MAX_WORDS_CAP
      maxWords = Math.min(MAX_WORDS_CAP, Math.max(20, maxWords))
      return { order: i + 1, prompt, guidance, maxWords, active: true }
    })
    .filter((q) => q.prompt)
  await ScholarshipQuestion.deleteMany({})
  if (clean.length) await ScholarshipQuestion.insertMany(clean)
  return ScholarshipQuestion.find({ active: true }).sort({ order: 1 })
}

// ---- Window helpers ---------------------------------------------------------

export function windowState(test, now = new Date()) {
  const hasWindow = test.startAt && test.endAt
  const upcoming = hasWindow && now < test.startAt
  const ended = hasWindow && now > test.endAt
  const open = !!(test.active && hasWindow && !upcoming && !ended)
  return { hasWindow, upcoming, ended, open }
}

// ---- Enrolment --------------------------------------------------------------

export async function enroll(userId, { institutionId, studentClass, section, rollNo } = {}) {
  const inst = await Institution.findOne({ _id: institutionId, status: 'approved' })
  if (!inst) throw httpError('Pick a valid partner institution', 400)
  const cls = String(studentClass || '').trim()
  const roll = String(rollNo || '').trim()
  if (!cls) throw httpError('Your class is required', 400)
  if (!roll) throw httpError('Your roll number is required', 400)
  const existing = await ScholarshipEnrollment.findOne({ user: userId })
  if (existing) throw httpError('You are already enrolled for the scholarship', 409, 'ALREADY_ENROLLED')
  return ScholarshipEnrollment.create({
    user: userId,
    institution: institutionId,
    studentClass: cls,
    section: String(section || '').trim(),
    rollNo: roll,
  })
}

/** Admin: every enrolment + student, institution and attempt status. */
export async function listEnrollments() {
  const enrollments = await ScholarshipEnrollment.find()
    .populate('user', 'name email')
    .populate('institution', 'name branch')
    .sort({ createdAt: -1 })
    .limit(1000)
  const attempts = await ScholarshipAttempt.find({ user: { $in: enrollments.map((e) => e.user?._id).filter(Boolean) } })
  const attByUser = new Map(attempts.map((a) => [String(a.user), a]))
  return enrollments.map((e) => {
    const att = attByUser.get(String(e.user?._id))
    return {
      id: e._id,
      name: e.user?.name || '—',
      email: e.user?.email || '',
      institution: e.institution?.name || '—',
      branch: e.institution?.branch || '',
      studentClass: e.studentClass || '',
      section: e.section || '',
      rollNo: e.rollNo || '',
      enrolledAt: e.enrolledAt || e.createdAt,
      attempt: att ? att.status : 'not_started',
      score: att?.status === 'submitted' ? att.score : null,
      total: att?.total ?? null,
    }
  })
}

/** Admin: remove an enrolment (also clears the student's attempt so they can re-enrol). */
export async function removeEnrollment(id) {
  const e = await ScholarshipEnrollment.findById(id)
  if (!e) throw httpError('Enrolment not found', 404)
  await ScholarshipAttempt.deleteOne({ user: e.user })
  await e.deleteOne()
}

/** A student's full scholarship state for the site UI. */
export async function getMyScholarship(userId) {
  const [test, enrollment, attempt] = await Promise.all([
    getTest(),
    ScholarshipEnrollment.findOne({ user: userId }).populate('institution', 'name type branch city state'),
    ScholarshipAttempt.findOne({ user: userId }),
  ])
  const w = windowState(test)
  const submitted = attempt?.status === 'submitted'
  const winner = await getWinnerInfo()
  return {
    winner,
    isWinner: !!winner && winner.userId === String(userId),
    test: {
      title: test.title,
      instructions: test.instructions,
      startAt: test.startAt,
      endAt: test.endAt,
      durationMins: test.durationMins,
      active: test.active,
      ...w,
    },
    enrolled: !!enrollment,
    institution: enrollment?.institution
      ? {
          id: enrollment.institution._id,
          name: enrollment.institution.name,
          type: enrollment.institution.type,
          branch: enrollment.institution.branch,
          city: enrollment.institution.city,
          state: enrollment.institution.state,
        }
      : null,
    student: enrollment
      ? { studentClass: enrollment.studentClass, section: enrollment.section, rollNo: enrollment.rollNo }
      : null,
    attempt: attempt
      ? { status: attempt.status, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, score: attempt.score, total: attempt.total }
      : null,
    canEnroll: !enrollment,
    canStart: !!enrollment && w.open && !submitted,
  }
}

// ---- Test taking (timed, auto-scored) ---------------------------------------

function deadlineFor(test, startedAt) {
  const byDuration = new Date(startedAt.getTime() + test.durationMins * 60 * 1000)
  return test.endAt && test.endAt < byDuration ? test.endAt : byDuration
}

export async function startAttempt(userId) {
  const test = await getTest()
  if (!windowState(test).open) throw httpError('The scholarship test is not open right now', 400, 'TEST_CLOSED')
  const enrollment = await ScholarshipEnrollment.findOne({ user: userId })
  if (!enrollment) throw httpError('Enrol for the scholarship first', 400, 'NOT_ENROLLED')

  const questions = await listQuestions({ withAnswers: false })
  if (!questions.length) throw httpError('The test has no questions yet', 400)

  let attempt = await ScholarshipAttempt.findOne({ user: userId })
  if (!attempt) {
    // Create-or-resume, race-safe: two near-simultaneous starts (e.g. React
    // StrictMode's double effect in dev, or a double-click) must not collide on
    // the unique {user} index — if we lose the race, fetch the winner instead.
    try {
      attempt = await ScholarshipAttempt.create({ user: userId, startedAt: new Date(), total: questions.length })
    } catch (e) {
      if (e?.code === 11000) attempt = await ScholarshipAttempt.findOne({ user: userId })
      else throw e
    }
  }
  if (attempt?.status === 'submitted') throw httpError('You have already submitted the test', 409, 'ALREADY_SUBMITTED')
  return { attemptId: attempt._id, startedAt: attempt.startedAt, deadline: deadlineFor(test, attempt.startedAt), questions }
}

export async function submitAttempt(userId, answers) {
  const attempt = await ScholarshipAttempt.findOne({ user: userId })
  if (!attempt) throw httpError('Start the test first', 400)
  if (attempt.status === 'submitted') throw httpError('You have already submitted the test', 409, 'ALREADY_SUBMITTED')

  const questions = await ScholarshipQuestion.find({ active: true }).sort({ order: 1, createdAt: 1 })
  const qById = new Map(questions.map((q) => [String(q._id), q]))

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

/** Ranked submitted attempts (top score first, earliest submit breaks ties). */
export async function leaderboard() {
  const attempts = await ScholarshipAttempt.find({ status: 'submitted' })
    .sort({ score: -1, submittedAt: 1 })
    .populate('user', 'name email')
    .limit(500)
  const enrollments = await ScholarshipEnrollment.find({ user: { $in: attempts.map((a) => a.user?._id).filter(Boolean) } })
    .populate('institution', 'name branch city state')
  const instByUser = new Map(enrollments.map((e) => [String(e.user), e.institution]))
  return attempts.map((a, i) => ({
    rank: i + 1,
    userId: a.user?._id || null,
    name: a.user?.name || '—',
    email: a.user?.email || '',
    institution: instByUser.get(String(a.user?._id))?.name || '—',
    score: a.score,
    total: a.total,
    submittedAt: a.submittedAt,
  }))
}

export async function declareWinner(userId) {
  const test = await getTest()
  const prev = test.declaredWinner ? String(test.declaredWinner) : null
  const exists = await User.findById(userId).select('_id')
  test.declaredWinner = exists ? userId : null
  await test.save()

  // Announce to everyone who took the test — but only when the winner actually
  // changes (so re-clicking "Declare" doesn't re-spam). Fire-and-forget.
  if (test.declaredWinner && String(test.declaredWinner) !== prev) {
    dispatchResultEmails(test.declaredWinner).catch((e) => console.error('✗ scholarship result emails failed:', e.message))
  }
  return test
}

/** Email every participant the result: the winner gets a "you won", the rest a
 *  "results announced" note. Sent sequentially to stay gentle on SMTP. */
async function dispatchResultEmails(winnerId) {
  const info = await getWinnerInfo()
  if (!info) return
  const attempts = await ScholarshipAttempt.find({ status: 'submitted' }).populate('user', 'name email')
  for (const a of attempts) {
    const email = a.user?.email
    if (!email) continue
    try {
      await sendScholarshipResultEmail(email, {
        name: a.user.name,
        won: String(a.user._id) === String(winnerId),
        winnerName: info.name,
        institution: info.institution,
      })
    } catch (e) {
      console.error(`✗ result email to ${email} failed:`, e.message)
    }
  }
}

/** Public: the declared winner (name + institution + score), or null. */
export async function getWinnerInfo() {
  const test = await getTest()
  if (!test.declaredWinner) return null
  const [user, enrollment, attempt] = await Promise.all([
    User.findById(test.declaredWinner).select('name'),
    ScholarshipEnrollment.findOne({ user: test.declaredWinner }).populate('institution', 'name'),
    ScholarshipAttempt.findOne({ user: test.declaredWinner }),
  ])
  if (!user) return null
  return {
    userId: String(test.declaredWinner),
    name: user.name || 'A student',
    institution: enrollment?.institution?.name || '',
    score: attempt?.status === 'submitted' ? attempt.score : null,
    total: attempt?.total ?? null,
  }
}
