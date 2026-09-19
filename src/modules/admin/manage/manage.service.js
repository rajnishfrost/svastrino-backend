// Admin management logic (SRS §4.9): dashboard stats, users, packages, content.
import { User } from '../../user/credentials/credentials.model.js'
import { accountStatus, AUTH_STATUS_FIELDS } from '../../user/credentials/accountStatus.js'
// Imported for its side effect as much as its value: listUsers populates
// `organisation`, and populate resolves the model by NAME — so a code path that
// reaches this file without the organisation module having been loaded throws
// MissingSchemaError instead of returning users.
import '../../user/organisation/organisation.model.js'
import { Order } from '../../user/payments/order.model.js'
import { Enrollment } from '../../user/payments/enrollment.model.js'
import { SkillBuild } from '../../user/skillbuild/skillbuild.model.js'
import { Package } from '../../user/skillbuild/package.model.js'
import { Session } from '../../user/learn/session.model.js'
import { Question } from '../../user/learn/question.model.js'
import { Answer } from '../../user/learn/answer.model.js'
import { MentoringBooking } from '../../user/mentoring/booking.model.js'

import { roleExists, rolePermissions, hasPanelAccess } from '../roles/roles.service.js'
import { pageOf, pageResult } from '../../../utils/paginate.js'
import { LIMITS, optionalLink, str, strList, text } from '../../../utils/validate.js'

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
export async function listUsers({ q, page, limit } = {}) {
  // Escaped and capped before it becomes a regex. Unescaped, an admin typing "("
  // into the search box got a 500 rather than no results, and a pattern like
  // "(a+)+$" is a query the database then spends real time on.
  const term = str(q, LIMITS.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const filter = term
    ? { $or: [{ name: new RegExp(term, 'i') }, { email: new RegExp(term, 'i') }] }
    : {}
  const p = pageOf({ page, limit })
  // The auth fields are select:false, and accountStatus needs them — without
  // them every account in this list would read as "Invited".
  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(p.skip)
      .limit(p.limit)
      .select(AUTH_STATUS_FIELDS)
      .populate('organisation', 'name')
      .populate('removedFromOrganisation', 'name')
      .populate('createdBy', 'name email'),
    User.countDocuments(filter),
  ])
  return pageResult(items, total, p)
}

/**
 * How many accounts came from where, across the WHOLE table rather than the 200
 * rows on screen — a count that only described the current page would be a
 * different number every time somebody searched.
 */
export async function signupBreakdown() {
  const rows = await User.aggregate([{ $group: { _id: '$signupMethod', n: { $sum: 1 } } }])
  const by = { password: 0, google: 0, invite: 0, guest: 0 }
  for (const r of rows) {
    // Accounts that predate the field have no value; they were all made the one
    // way that existed then, so counting them as email keeps the total honest.
    const key = r._id && key_in(by, r._id) ? r._id : 'password'
    by[key] += r.n
  }
  return { ...by, total: Object.values(by).reduce((a, b) => a + b, 0) }
}

const key_in = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)

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
  // to the full Edit form, which can.
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

const PKG_FIELDS = ['name', 'tagline', 'price', 'earlyBird', 'period', 'durationDays', 'sessionsCount', 'sessionMins', 'features', 'benefits', 'modeLabel', 'priceNote', 'summary', 'trustLine', 'durationLabel', 'sessionsLabel', 'deliveryMode', 'buyMode', 'expertEnquiry', 'paymentMode', 'phases', 'includesPsychometric', 'cta', 'variant', 'featured', 'badge', 'order', 'active', 'listed']

/**
 * How long each of a package's text fields may be.
 *
 * Every one of these is drawn on a pricing card, so the cap is what the card can
 * show rather than what the box will accept. Declared once and applied on create
 * and on update, because the two used to shape the same fields differently: the
 * create path at least ran them through String(), while the update path assigned
 * body[f] straight onto the document and would take an object.
 */
const PKG_CAPS = {
  name: LIMITS.title,
  tagline: LIMITS.shortText,
  period: 24,
  modeLabel: LIMITS.name,
  priceNote: LIMITS.shortText,
  summary: LIMITS.description,
  trustLine: LIMITS.shortText,
  durationLabel: LIMITS.name,
  sessionsLabel: LIMITS.name,
  deliveryMode: LIMITS.name,
  cta: LIMITS.name,
  variant: LIMITS.slug,
  badge: LIMITS.name,
}

// '' / null → null, otherwise Number — for the optional numeric fields.
const numOrNull = (v) => (v === '' || v == null ? null : Number(v))

/** Normalise whichever of a package's fields are present, in place. */
function shapePackageFields(update) {
  for (const [f, max] of Object.entries(PKG_CAPS)) {
    if (update[f] !== undefined) update[f] = str(update[f], max)
  }
  if (update.price != null) update.price = Number(update.price)
  if (update.phases !== undefined) update.phases = Math.max(1, Number(update.phases) || 1)
  if (update.includesPsychometric !== undefined) update.includesPsychometric = !!update.includesPsychometric
  if (update.listed !== undefined) update.listed = update.listed !== false
  if (update.featured !== undefined) update.featured = !!update.featured
  if (update.active !== undefined) update.active = update.active !== false
  if (update.order !== undefined) update.order = Number(update.order) || 0
  if (update.buyMode !== undefined) update.buyMode = update.buyMode === 'expert-call' ? 'expert-call' : 'self-serve'
  // Whether the program page leads with the "Talk to an Expert" form. Separate
  // from buyMode: a program can take a negotiated price through that form and
  // still sell at the listed price from the checkout.
  if (update.expertEnquiry !== undefined) update.expertEnquiry = update.expertEnquiry === true || update.expertEnquiry === 'true'
  if (update.paymentMode !== undefined) update.paymentMode = update.paymentMode === 'per-phase' ? 'per-phase' : 'one-time'
  // Bullet lists: twenty lines of a card's worth each. An array is the one shape
  // a cap on a single string never reaches.
  for (const f of ['features', 'benefits']) {
    if (update[f] !== undefined) update[f] = strList(update[f], { max: LIMITS.shortText, count: 20 })
  }
  for (const f of ['earlyBird', 'durationDays', 'sessionsCount', 'sessionMins']) {
    if (update[f] !== undefined) update[f] = numOrNull(update[f])
  }
  return update
}

export async function updatePackage(id, body) {
  const update = {}
  for (const f of PKG_FIELDS) if (body[f] !== undefined) update[f] = body[f]
  shapePackageFields(update)
  const pkg = await Package.findByIdAndUpdate(id, update, { new: true }).populate('skillBuild', 'name slug kind')
  if (!pkg) throw httpError('Package not found', 404)
  return pkg
}

/** New priced package under an existing skill-build (course tier OR mentoring program). */
export async function createPackage(body) {
  const sb = await SkillBuild.findOne({ slug: str(body.skillBuildSlug, LIMITS.slug).toLowerCase() })
  if (!sb) throw httpError('Pick a skill-build for this package', 400)

  const sku = str(body.sku, LIMITS.slug).toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(sku)) throw httpError('SKU: lowercase letters/numbers/dashes only', 400)
  if (!(Number(body.price) > 0)) throw httpError('Price (₹) is required', 400)
  if (await Package.findOne({ sku })) throw httpError('That SKU is already in use', 409)

  // The same shaping the update path uses, so a package created here and a
  // package edited later end up with the same rules applied to the same fields.
  const fields = {}
  for (const f of PKG_FIELDS) if (body[f] !== undefined) fields[f] = body[f]
  shapePackageFields(fields)
  if (!fields.name) throw httpError('Name is required', 400)

  const pkg = await Package.create({
    ...fields,
    skillBuild: sb._id,
    sku,
    slug: str(body.slug, LIMITS.slug) || sku.replace(new RegExp(`^${sb.slug}-`), ''),
    price: Number(body.price),
    period: fields.period || 'one-time',
    buyMode: fields.buyMode || 'self-serve',
    // `fields`, not `body`: the raw body would skip the coercion above, so the
    // string "false" from a form post would create a package with the flag ON.
    // Only written when the caller actually asked for it — an explicit false on
    // every new row would kill the `?? buyMode === 'expert-call'` fallback that
    // readers rely on for rows that predate the field.
    ...(fields.expertEnquiry === undefined ? {} : { expertEnquiry: fields.expertEnquiry }),
    paymentMode: fields.paymentMode || 'one-time',
    phases: fields.phases ?? 1,
    includesPsychometric: !!body.includesPsychometric,
    cta: fields.cta || 'Buy now',
    featured: !!body.featured,
    badge: fields.badge || null,
    order: fields.order ?? 0,
    active: body.active !== false,
    listed: body.listed !== false,
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
    update.name = str(body.name, LIMITS.title)
    if (!update.name) throw httpError('Name is required', 400)
  }
  if (body.tagline !== undefined) update.tagline = str(body.tagline, LIMITS.shortText)
  if (body.order !== undefined) update.order = Number(body.order) || 0
  if (body.active !== undefined) update.active = !!body.active
  const sb = await SkillBuild.findOneAndUpdate({ slug }, update, { new: true })
  if (!sb) throw httpError('Skill-Build not found', 404)
  return sb
}

/** New top-level product. kind: 'course' (videos/sessions) | 'mentoring' (bookable). */
export async function createSkillBuild(body) {
  const slug = str(body.slug, LIMITS.slug).toLowerCase()
  const name = str(body.name, LIMITS.title)
  const kind = body.kind === 'mentoring' ? 'mentoring' : 'course'
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) throw httpError('Slug: lowercase letters/numbers/dashes only', 400)
  if (!name) throw httpError('Name is required', 400)
  if (await SkillBuild.findOne({ slug })) throw httpError('That slug is already in use', 409)
  return SkillBuild.create({
    slug,
    name,
    kind,
    tagline: str(body.tagline, LIMITS.shortText),
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
    title: str(body.title, LIMITS.title),
    description: text(body.description, LIMITS.description),
    // Played in a <video>/HLS source, so it has to be a link: either an https URL
    // or the relative path our own uploader returns.
    videoUrl: optionalLink(body.videoUrl, { field: 'videoUrl' }),
    durationMins: Number(body.durationMins) || 0,
    worksheet: {
      title: str(body.worksheet?.title, LIMITS.title),
      // A worksheet is a list of things to do, read on one screen — fifty lines is
      // already more than any session has ever had.
      tasks: strList(body.worksheet?.tasks, { max: LIMITS.shortText, count: 50 }),
    },
    // Timeline notes: a caption shown over the player at a given second. Capped at
    // a hundred, because they are drawn as markers on a bar that is a few hundred
    // pixels wide.
    notes: Array.isArray(body.notes)
      ? body.notes
          .filter((n) => n && Number.isFinite(Number(n.time)) && str(n.text, LIMITS.shortText))
          .map((n) => ({
            time: Math.max(0, Math.round(Number(n.time))),
            text: str(n.text, LIMITS.shortText),
          }))
          .sort((a, b) => a.time - b.time)
          .slice(0, 100)
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

  // Six questions per session is the product rule; the cap on each is what the
  // student's screen shows above the answer box.
  const clean = strList(prompts, { max: LIMITS.subject * 2, count: 6 })

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
