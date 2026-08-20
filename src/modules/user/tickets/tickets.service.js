import mongoose from 'mongoose'

import { Ticket, TICKET_STATUSES } from './ticket.model.js'
import { Enrollment } from '../payments/enrollment.model.js'
import { courseAccess, effectiveExpiry } from '../learn/courseAccess.js'
import { User } from '../credentials/credentials.model.js'
import { notify } from '../notifications/notifications.service.js'

const httpError = (message, status, code) => {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

// An id that is not an ObjectId at all is still just an id we do not hold, so
// it deserves the same 404 as a well-formed one we cannot find. Left to
// Mongoose it would throw a CastError on the way to the database, which carries
// no status and surfaces as a 500 quoting our model and field names.
const isId = (id) => mongoose.isValidObjectId(id)

// The panel works through a queue, not an archive; a list this long already
// means something has gone badly wrong upstream.
const MAX_LIST = 500

const DAY_MS = 24 * 60 * 60 * 1000

// Students and parents read these threads, so dates are written the way they
// would say them out loud rather than as a timestamp.
const readableDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

/** The display name to stamp on a message, falling back when an account has none. */
async function authorNameFor(userId, fallback) {
  const account = await User.findById(userId).select('name')
  return account?.name?.trim() || fallback
}

// ---- The student's side ------------------------------------------------------

/**
 * Start a conversation. The first message is always the student's.
 *
 * A student whose course has just locked is frustrated, and a frustrated person
 * presses the button again. So a second message about the same course in the
 * same category, while a thread is still running, is added to the thread they
 * already have instead of opening a new one. That keeps their history in one
 * place, and keeps the admin queue from filling with twenty copies of one
 * problem. Only live threads count — once a ticket is resolved or closed, a new
 * question about the same course is genuinely a new conversation.
 */
export async function createTicket(userId, { subject, category, product, text }) {
  // The slug is checked against what this student actually holds, because the
  // form's picker constrains nothing once the endpoint is called directly. It
  // is also the key that decides whether this is a repeat press of the same
  // problem, so a slug nobody owns must not be able to open a fresh thread.
  // It keeps this in step with grantAccess too, which looks for the same
  // enrolment — without the check a student could open a conversation that no
  // admin could ever act on.
  if (product) {
    const holds = await Enrollment.exists({ user: userId, product })
    if (!holds) {
      throw httpError(
        'We could not find that course on your account. Please choose one of your courses, or leave the course box empty if your question is not about a course.',
        400,
        'NOT_YOUR_COURSE'
      )
    }
  }

  const live = await Ticket.findOne({
    user: userId,
    product: product || '',
    category,
    status: { $in: ['open', 'awaiting_student'] },
  })
  if (live) {
    // Their words have to land in that thread. Handing back the old
    // conversation and dropping the message would lose what they wrote while
    // the reply still tells them we had kept it together, and the admin would
    // never see the new question at all.
    const at = new Date()
    const name = await authorNameFor(userId, 'Student')
    live.messages.push({ from: 'student', author: userId, authorName: name, text, at })
    live.lastMessageAt = at
    // The ball is with us again, and the queue sorts on lastMessageAt, so this
    // also lifts the thread back to where an admin will see it.
    live.status = 'open'
    await live.save()
    return { ticket: live, created: false }
  }

  const authorName = await authorNameFor(userId, 'Student')
  const now = new Date()
  const ticket = await Ticket.create({
    user: userId,
    subject,
    category,
    product: product || '',
    status: 'open',
    messages: [{ from: 'student', author: userId, authorName, text, at: now }],
    lastMessageAt: now,
  })
  return { ticket, created: true }
}

/** That student's conversations, most recently active first. */
export async function listMine(userId) {
  return Ticket.find({ user: userId }).sort({ lastMessageAt: -1 }).limit(MAX_LIST)
}

/**
 * One of the student's own conversations. Always scoped by user as well as id,
 * never by id alone — a guessed id from somebody else's account has to be a 404
 * and not a support thread full of another family's details.
 */
export async function getMine(userId, id) {
  if (!isId(id)) throw httpError('We could not find that conversation', 404)
  const ticket = await Ticket.findOne({ _id: id, user: userId })
  if (!ticket) throw httpError('We could not find that conversation', 404)
  return ticket
}

/**
 * The student writes back. Whatever the thread was waiting for, it is now
 * waiting on us — including a resolved one, which reopens rather than making
 * them start again with none of the history.
 */
export async function replyAsStudent(userId, id, text) {
  const ticket = await getMine(userId, id)
  if (ticket.status === 'closed') {
    throw httpError(
      'This conversation has been closed. Please start a new one and we will pick it up from there.',
      400,
      'TICKET_CLOSED'
    )
  }

  const now = new Date()
  const authorName = await authorNameFor(userId, 'Student')
  ticket.messages.push({ from: 'student', author: userId, authorName, text, at: now })
  ticket.lastMessageAt = now
  // Leaving 'resolved' by writing into the thread clears the stamp exactly as
  // setStatus does, because a conversation that is running once more has not
  // been settled by anybody and a stamp left behind would mislead the next
  // admin who reads it.
  if (ticket.status === 'resolved') {
    ticket.resolvedAt = null
    ticket.resolvedBy = null
  }
  if (ticket.status === 'awaiting_student' || ticket.status === 'resolved') ticket.status = 'open'
  await ticket.save()
  return ticket
}

// ---- The panel ---------------------------------------------------------------

/**
 * The admin queue. Newest activity first, so a thread somebody has just written
 * into rises to the top.
 *
 * The search box is aimed at whoever is on the phone: an admin usually knows
 * the student's name or email, sometimes the subject. Names live on the account
 * rather than the ticket, so those are resolved to ids first and folded into the
 * same query — two round trips, but one sorted, limited result set.
 */
export async function adminList({ status, q } = {}) {
  const filter = {}
  if (status && TICKET_STATUSES.includes(status)) filter.status = status

  const term = String(q ?? '').trim()
  if (term) {
    // Regex (not $text) so a partial name matches while the admin is typing.
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const students = await User.find({ $or: [{ name: rx }, { email: rx }] })
      .select('_id')
      .limit(MAX_LIST)
    filter.$or = [
      { subject: rx },
      { product: rx },
      { user: { $in: students.map((s) => s._id) } },
    ]
  }

  return Ticket.find(filter)
    .sort({ lastMessageAt: -1 })
    .limit(MAX_LIST)
    .populate('user', 'name email')
}

export async function adminGet(id) {
  if (!isId(id)) throw httpError('Ticket not found', 404)
  const ticket = await Ticket.findById(id).populate('user', 'name email')
  if (!ticket) throw httpError('Ticket not found', 404)
  return ticket
}

/** An admin answers. The ball moves to the student. */
export async function replyAsAdmin(adminId, id, text) {
  const ticket = await adminGet(id)
  if (ticket.status === 'closed') {
    throw httpError('This ticket is closed. Reopen it before replying.', 400, 'TICKET_CLOSED')
  }

  const now = new Date()
  const authorName = await authorNameFor(adminId, 'Svastrino team')
  ticket.messages.push({ from: 'admin', author: adminId, authorName, text, at: now })
  ticket.lastMessageAt = now
  // Same rule as above: replying to a resolved ticket sets it running again, so
  // the record of it having been settled comes off with the status.
  if (ticket.status === 'resolved') {
    ticket.resolvedAt = null
    ticket.resolvedBy = null
  }
  ticket.status = 'awaiting_student'
  await ticket.save()

  // A reply nobody notices is a reply nobody made, so raise a notification.
  // notify() swallows its own failures, so this can never break the reply.
  await notify(ticket.user?._id || ticket.user, {
    kind: 'system',
    title: 'We have replied to your message',
    body: ticket.subject,
    // Straight to their own conversation, so the reply we just announced is
    // the first thing they read. /support/:id is scoped by { _id, user } on
    // the server, so this can only ever open this student's own thread.
    link: `/support/${ticket._id}`,
  })

  return ticket
}

/**
 * Move a ticket along by hand.
 *
 * Resolving stamps who settled it and when. Moving a resolved ticket back to
 * open clears that stamp again, because a thread that is running once more has
 * not been settled by anybody and saying otherwise would mislead the next admin
 * who reads it.
 */
export async function setStatus(adminId, id, status) {
  if (!TICKET_STATUSES.includes(status)) throw httpError('That is not a valid status', 400)
  const ticket = await adminGet(id)

  ticket.status = status
  if (status === 'resolved') {
    ticket.resolvedAt = new Date()
    ticket.resolvedBy = adminId
  } else if (status === 'open' || status === 'awaiting_student') {
    ticket.resolvedAt = null
    ticket.resolvedBy = null
  }
  await ticket.save()
  return ticket
}

/**
 * Give the student their course back — the whole point of the ticket system.
 *
 * A course is valid for one year. When that year runs out the course locks, and
 * this is the one door out of it: an admin talks the student through it and, if
 * it is fair, pushes their access window out by a few more days.
 *
 * The trap is where those days are counted FROM. A student comes here precisely
 * because their expiresAt is in the past, so adding thirty days to it would
 * hand back a window that closed weeks ago and the course would still be
 * locked — the grant would look done and change nothing. So the days are always
 * counted from whichever is later, the existing expiry or right now.
 *
 * Every enrolment for that course is moved, not just one. A pay-as-you-use
 * student holds several (one per phase they bought), and courseAccess decides
 * the lock from the EARLIEST of them, so leaving one behind would let the grant
 * look done while the course stayed shut.
 */
export async function grantAccess(adminId, id, days) {
  // Re-checked here rather than trusted from the route, because this is the
  // function that changes what a student paid for.
  const n = Number(days)
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    throw httpError('Enter how many days of access to give, as a whole number from 1 to 365', 400)
  }

  const ticket = await adminGet(id)
  if (!ticket.product) {
    throw httpError(
      'This ticket is not linked to a course, so there is no access to reopen. Ask the student which course it is about, then use a ticket for that course.',
      400,
      'TICKET_NO_PRODUCT'
    )
  }

  const studentId = ticket.user?._id || ticket.user
  const enrolments = await Enrollment.find({ user: studentId, product: ticket.product })
  if (!enrolments.length) {
    throw httpError(
      `We could not find an enrolment for “${ticket.product}” on this account, so there is nothing to reopen.`,
      400,
      'NO_ENROLMENT'
    )
  }

  const now = new Date()
  let moved = 0

  for (const e of enrolments) {
    // A refunded enrolment stays shut: the money went back, so the access does
    // not come back with a support conversation.
    if (e.status === 'revoked') continue
    // No end date anywhere is a lifetime enrolment. Writing a date onto it would
    // take access away in the name of giving it, so it is left exactly as it is.
    const current = await effectiveExpiry(e)
    if (!current) continue

    const from = current.getTime() > now.getTime() ? current : now
    e.expiresAt = new Date(from.getTime() + n * DAY_MS)
    // The nightly expiry sweep may already have marked it expired; the whole
    // point of this action is that it is not expired any more.
    if (e.status === 'expired') e.status = 'active'
    await e.save()

    moved += 1
  }

  if (!moved) {
    throw httpError(
      'This student has no enrolment that can be reopened for that course — it is either refunded or already open with no end date.',
      400,
      'NOTHING_TO_REOPEN'
    )
  }

  // The date we promise has to be the date the course really locks on, and that
  // is read off the earliest enrolment, not the most generous one. Asking
  // courseAccess after the rows have moved is the only way that sentence stays
  // true for a student who holds one enrolment per phase.
  const access = await courseAccess(studentId, ticket.product)
  const until = access.expiresAt ? readableDate(access.expiresAt) : null
  const body = until
    ? `Your course is open again for ${n} ${n === 1 ? 'day' : 'days'}. ` +
      `You can use it until ${until}. Please try to finish inside that time.`
    : `Your course is open again for ${n} ${n === 1 ? 'day' : 'days'}. ` +
      'Please try to finish inside that time.'

  // A second grant on the same ticket really does stack on top of the first, so
  // the record adds up instead of replacing. Keeping only the latest number
  // would tell the next admin the student had less time than they were given,
  // and that number is what the warning on the panel is built from. The date is
  // the most recent grant.
  const daysSoFar = ticket.accessGrant?.days || 0
  ticket.accessGrant = { days: daysSoFar + n, grantedAt: now, grantedBy: adminId }
  // And the grants themselves, one entry each, in order. The summary above is
  // what the panel warns on; this is the answer to "how did they end up with
  // that much time?", which a total on its own cannot give.
  ticket.grants.push({ days: n, grantedAt: now, grantedBy: adminId, newExpiry: access.expiresAt || null })
  ticket.messages.push({
    from: 'admin',
    author: adminId,
    authorName: await authorNameFor(adminId, 'Svastrino team'),
    text: body,
    at: now,
  })
  ticket.lastMessageAt = now
  ticket.status = 'resolved'
  ticket.resolvedAt = now
  ticket.resolvedBy = adminId
  await ticket.save()

  // Telling the student must never be able to undo the thing we are telling
  // them about. notify() already swallows its own failures; the try/catch is
  // there so nothing else in that path can take the grant down with it.
  try {
    await notify(studentId, {
      kind: 'course',
      title: 'Your course is open again',
      body,
      link: `/learn/${ticket.product}`,
    })
  } catch (err) {
    console.error('✗ Access was granted but the student could not be notified:', err.message)
  }

  return ticket
}
