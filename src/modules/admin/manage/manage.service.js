// Admin management logic (SRS §4.9): dashboard stats, users, packages, content.
import { User } from '../../user/credentials/credentials.model.js'
import { Order } from '../../user/payments/order.model.js'
import { Enrollment } from '../../user/payments/enrollment.model.js'
import { SkillBuild } from '../../user/skillbuild/skillbuild.model.js'
import { Package } from '../../user/skillbuild/package.model.js'
import { Session } from '../../user/learn/session.model.js'
import { Question } from '../../user/learn/question.model.js'
import { Answer } from '../../user/learn/answer.model.js'
import { MentoringBooking } from '../../user/mentoring/booking.model.js'

import { roleExists, rolePermissions, hasPanelAccess } from '../roles/roles.service.js'

const httpError = (message, status) => {
  const err = new Error(message)
  err.status = status
  return err
}

// --- Dashboard stats ---------------------------------------------------------
export async function stats() {
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)

  const [
    users, verified, activeEnrollments, paid, refunded,
    newUsers7d, courses, upcomingBookings, totalBookings,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ emailVerified: true }),
    Enrollment.countDocuments({ status: 'active' }),
    Order.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, sum: { $sum: '$amount' }, n: { $sum: 1 } } }]),
    Order.aggregate([{ $match: { status: 'refunded' } }, { $group: { _id: null, sum: { $sum: '$amount' } } }]),
    User.countDocuments({ createdAt: { $gte: weekAgo } }),
    SkillBuild.countDocuments({ kind: 'course', active: true }),
    MentoringBooking.countDocuments({ status: 'booked', startAt: { $gte: now } }),
    MentoringBooking.countDocuments({ status: { $ne: 'cancelled' } }),
  ])

  const revenue = paid[0]?.sum || 0
  const paidOrders = paid[0]?.n || 0
  const refundedAmt = refunded[0]?.sum || 0
  return {
    users,
    verifiedUsers: verified,
    newUsers7d,
    activeStudents: activeEnrollments,
    revenue,                                        // paise (gross)
    refunded: refundedAmt,                          // paise
    netRevenue: Math.max(0, revenue - refundedAmt), // paise
    paidOrders,
    avgOrder: paidOrders ? Math.round(revenue / paidOrders) : 0, // paise
    courses,
    upcomingBookings,
    totalBookings,
  }
}

// --- Accounts (unified: site users + panel admins live in one collection) ----
export async function listUsers({ q } = {}) {
  const filter = q
    ? { $or: [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }] }
    : {}
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(200)
  return users
}

/**
 * Change an account's role from the list. Assigning an elevated role
 * (admin/superadmin) is superadmin-only; the last active superadmin can't be
 * demoted, and you can't demote yourself out of superadmin.
 */
/**
 * Open or close the student portal for one account.
 *
 * Only a superadmin decides this — it is an access grant, and the same rule
 * already guards handing out panel access. A student is refused outright rather
 * than silently ignored: their account IS the portal, so a switch that appeared
 * to turn it off would be lying about what it did.
 */
export async function setUserSiteAccess(actor, userId, siteAccess) {
  if (actor?.role !== 'superadmin') throw httpError('Only a superadmin can change portal access', 403)

  const user = await User.findById(userId)
  if (!user) throw httpError('User not found', 404)
  if ((user.role || 'student') === 'student') {
    throw httpError('A student account always has the student portal. Change its role first.', 400)
  }

  user.siteAccess = siteAccess
  await user.save()
  return user
}

export async function setUserRole(actor, userId, role) {
  if (!(await roleExists(role))) throw httpError('Invalid role', 400)
  const user = await User.findById(userId)
  if (!user) throw httpError('User not found', 404)

  // The `organisation` role needs an Organisation record alongside it, and this
  // inline dropdown has nowhere to collect one — so both directions are pushed
  // to the full Edit form (or the Scholarship page), which can.
  if (role !== user.role && (role === 'organisation' || user.role === 'organisation')) {
    throw httpError(
      role === 'organisation'
        ? 'Use “Edit” to switch an account to Organisation — it needs the organisation’s name and address.'
        : 'This is an organisation account. Use “Edit” to change its role.',
      400
    )
  }

  const demotingSuper = user.role === 'superadmin' && role !== 'superadmin'
  const isSelf = actor && String(actor.id) === String(userId)

  // Any role that grants panel access can only be handed out by a superadmin.
  const grantsPanel = hasPanelAccess(role, await rolePermissions(role))
  if (grantsPanel && actor?.role !== 'superadmin') {
    throw httpError('Only a superadmin can grant panel access', 403)
  }
  if (isSelf && demotingSuper) throw httpError('You cannot demote your own account', 400)
  if (demotingSuper) {
    const others = await User.countDocuments({ _id: { $ne: user._id }, role: 'superadmin', active: true })
    if (others === 0) throw httpError('At least one active superadmin must remain', 400)
  }

  user.role = role
  await user.save()
  return user
}

// --- Packages (pricing) ------------------------------------------------------
export async function listPackages() {
  return Package.find().populate('skillBuild', 'name slug kind').sort({ order: 1 })
}

const PKG_FIELDS = ['name', 'tagline', 'price', 'earlyBird', 'period', 'durationDays', 'sessionsCount', 'sessionMins', 'features', 'cta', 'variant', 'featured', 'badge', 'order', 'active']
// '' / null → null, otherwise Number — for the optional numeric fields.
const numOrNull = (v) => (v === '' || v == null ? null : Number(v))
export async function updatePackage(id, body) {
  const update = {}
  for (const f of PKG_FIELDS) if (body[f] !== undefined) update[f] = body[f]
  if (update.price != null) update.price = Number(update.price)
  for (const f of ['earlyBird', 'durationDays', 'sessionsCount', 'sessionMins']) {
    if (update[f] !== undefined) update[f] = numOrNull(update[f])
  }
  const pkg = await Package.findByIdAndUpdate(id, update, { new: true }).populate('skillBuild', 'name slug kind')
  if (!pkg) throw httpError('Package not found', 404)
  return pkg
}

/** New priced package under an existing skill-build (course tier OR mentoring program). */
export async function createPackage(body) {
  const sb = await SkillBuild.findOne({ slug: String(body.skillBuildSlug || '').toLowerCase().trim() })
  if (!sb) throw httpError('Pick a skill-build for this package', 400)

  const sku = String(body.sku || '').toLowerCase().trim()
  const name = String(body.name || '').trim()
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(sku)) throw httpError('SKU: lowercase letters/numbers/dashes only', 400)
  if (!name) throw httpError('Name is required', 400)
  if (!(Number(body.price) > 0)) throw httpError('Price (₹) is required', 400)
  if (await Package.findOne({ sku })) throw httpError('That SKU is already in use', 409)

  const pkg = await Package.create({
    skillBuild: sb._id,
    sku,
    slug: String(body.slug || '').trim() || sku.replace(new RegExp(`^${sb.slug}-`), ''),
    name,
    tagline: String(body.tagline || '').trim(),
    price: Number(body.price),
    earlyBird: numOrNull(body.earlyBird),
    period: String(body.period || 'one-time').trim() || 'one-time',
    durationDays: numOrNull(body.durationDays),
    sessionsCount: numOrNull(body.sessionsCount),
    sessionMins: numOrNull(body.sessionMins),
    features: Array.isArray(body.features) ? body.features.filter(Boolean) : [],
    cta: String(body.cta || '').trim() || 'Buy now',
    featured: !!body.featured,
    badge: String(body.badge || '').trim() || null,
    order: Number(body.order) || 0,
    active: body.active !== false,
  })
  return pkg.populate('skillBuild', 'name slug kind')
}

// --- Skill-builds (products) -------------------------------------------------

/** Every product (courses AND mentoring) — for admin pickers/labels. */
export async function listAllSkillBuilds() {
  return SkillBuild.find().sort({ kind: 1, order: 1 })
}

/** Edit a skill-build's display fields (slug/kind are immutable — payments key off them). */
export async function updateSkillBuild(slug, body) {
  const update = {}
  if (body.name !== undefined) {
    update.name = String(body.name).trim()
    if (!update.name) throw httpError('Name is required', 400)
  }
  if (body.tagline !== undefined) update.tagline = String(body.tagline).trim()
  if (body.order !== undefined) update.order = Number(body.order) || 0
  if (body.active !== undefined) update.active = !!body.active
  const sb = await SkillBuild.findOneAndUpdate({ slug }, update, { new: true })
  if (!sb) throw httpError('Skill-Build not found', 404)
  return sb
}

/** New top-level product. kind: 'course' (videos/sessions) | 'mentoring' (bookable). */
export async function createSkillBuild(body) {
  const slug = String(body.slug || '').toLowerCase().trim()
  const name = String(body.name || '').trim()
  const kind = body.kind === 'mentoring' ? 'mentoring' : 'course'
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) throw httpError('Slug: lowercase letters/numbers/dashes only', 400)
  if (!name) throw httpError('Name is required', 400)
  if (await SkillBuild.findOne({ slug })) throw httpError('That slug is already in use', 409)
  return SkillBuild.create({
    slug,
    name,
    kind,
    tagline: String(body.tagline || '').trim(),
    order: Number(body.order) || 0,
    active: body.active !== false,
  })
}

// --- Course content (sessions / videos / worksheets) -------------------------
export async function listSkillBuilds() {
  // Content manager = video courses only; mentoring has no sessions/videos.
  return SkillBuild.find({ kind: { $ne: 'mentoring' } }).sort({ order: 1 })
}

export async function listSessions(slug) {
  const sb = await SkillBuild.findOne({ slug })
  if (!sb) throw httpError('Skill-Build not found', 404)
  const sessions = await Session.find({ skillBuild: sb._id }).sort({ order: 1 })
  return { skillBuild: sb, sessions }
}

function sessionFromBody(body) {
  return {
    order: Number(body.order) || 1,
    tier: Number(body.tier) || 1,
    title: String(body.title || '').trim(),
    description: String(body.description || '').trim(),
    videoUrl: String(body.videoUrl || '').trim(),
    durationMins: Number(body.durationMins) || 0,
    worksheet: {
      title: String(body.worksheet?.title || '').trim(),
      tasks: Array.isArray(body.worksheet?.tasks) ? body.worksheet.tasks.filter(Boolean) : [],
    },
    notes: Array.isArray(body.notes)
      ? body.notes
          .filter((n) => n && Number.isFinite(Number(n.time)) && String(n.text || '').trim())
          .map((n) => ({ time: Math.max(0, Math.round(Number(n.time))), text: String(n.text).trim() }))
          .sort((a, b) => a.time - b.time)
      : [],
    active: body.active !== false,
  }
}

export async function createSession(slug, body) {
  const sb = await SkillBuild.findOne({ slug })
  if (!sb) throw httpError('Skill-Build not found', 404)
  const data = sessionFromBody(body)
  if (!data.title) throw httpError('Title is required', 400)
  return Session.create({ ...data, skillBuild: sb._id })
}

export async function updateSession(id, body) {
  const data = sessionFromBody(body)
  if (!data.title) throw httpError('Title is required', 400)
  const s = await Session.findByIdAndUpdate(id, data, { new: true })
  if (!s) throw httpError('Session not found', 404)
  return s
}

export async function deleteSession(id) {
  const s = await Session.findByIdAndDelete(id)
  if (!s) throw httpError('Session not found', 404)
  await Question.deleteMany({ session: id }) // drop its questions too
  return { ok: true }
}

// --- Post-video questions (up to 6 per session, ordered) ---------------------
export async function listQuestions(sessionId) {
  const session = await Session.findById(sessionId)
  if (!session) throw httpError('Session not found', 404)
  const questions = await Question.find({ session: session._id }).sort({ order: 1 })
  return { session, questions }
}

/** Replace a session's questions with the given prompt list (max 6, ordered). */
export async function saveQuestions(sessionId, prompts) {
  const session = await Session.findById(sessionId)
  if (!session) throw httpError('Session not found', 404)

  const clean = (Array.isArray(prompts) ? prompts : [])
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .slice(0, 6)

  // Upsert by order (keeps existing rows + any answers intact where possible).
  const ops = clean.map((prompt, i) => ({
    updateOne: {
      filter: { session: session._id, order: i + 1 },
      update: { $set: { prompt, active: true, skillBuild: session.skillBuild } },
      upsert: true,
    },
  }))
  if (ops.length) await Question.bulkWrite(ops)
  await Question.deleteMany({ session: session._id, order: { $gt: clean.length } })

  return listQuestions(sessionId)
}

/** Every student answer for a session, grouped under its question. */
export async function listSessionAnswers(sessionId) {
  const session = await Session.findById(sessionId)
  if (!session) throw httpError('Session not found', 404)

  const [questions, answers] = await Promise.all([
    Question.find({ session: session._id }).sort({ order: 1 }),
    Answer.find({ session: session._id }).sort({ submittedAt: 1 }).populate('user', 'name email'),
  ])

  const byQuestion = new Map()
  for (const a of answers) {
    const k = String(a.question)
    if (!byQuestion.has(k)) byQuestion.set(k, [])
    byQuestion.get(k).push({
      student: a.user ? { name: a.user.name, email: a.user.email } : { name: '(deleted account)', email: '' },
      text: a.text,
      submittedAt: a.submittedAt,
    })
  }

  return {
    session: { id: session._id, order: session.order, title: session.title },
    totalAnswers: answers.length,
    questions: questions.map((q) => ({
      id: q._id,
      order: q.order,
      prompt: q.prompt,
      answers: byQuestion.get(String(q._id)) || [],
    })),
  }
}
