import { TICKET_CATEGORIES } from './ticket.model.js'

const fail = (message, field) => {
  const err = new Error(message)
  err.status = 400
  if (field) err.field = field
  return err
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max)

// The whole thread is read on one screen, so a single message is capped well
// below an essay. Long enough for a student to explain themselves properly.
const MAX_MESSAGE = 4000
const MAX_SUBJECT = 120
const MAX_PRODUCT = 60

/**
 * A course slug, and nothing else. The form fills this in from the courses the
 * student actually holds, so anything that is not slug shaped did not come from
 * the picker.
 *
 * Two things ride on it, which is why it is checked at all rather than merely
 * trimmed. The panel shows this value to an admin as the course the ticket is
 * about, so free prose here would read as a course name that does not exist.
 * And a second ticket about the same course and category hands back the thread
 * the student already has instead of opening another one, so a field that
 * accepts anything is a field that can be varied to defeat that and fill the
 * queue. Empty stays perfectly valid — a general question is about no course.
 */
const PRODUCT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Validate and normalise the first message of a new ticket. */
export function validateTicketCreate(body = {}) {
  const subject = clean(body.subject, MAX_SUBJECT)
  const text = clean(body.text ?? body.message, MAX_MESSAGE)
  const product = clean(body.product, MAX_PRODUCT).toLowerCase()
  const category = TICKET_CATEGORIES.includes(body.category) ? body.category : 'other'

  if (subject.length < 3) throw fail('Please give this a short title so we know what it is about', 'subject')
  if (!text) throw fail('Please tell us what you need help with', 'text')
  if (product && !PRODUCT_SLUG.test(product)) {
    throw fail(
      'Please choose your course from the list. If your question is not about a course, leave that box empty.',
      'product'
    )
  }

  return { subject, text, product, category }
}

/** Validate a reply — from the student or from an admin, the rule is the same. */
export function validateReply(body = {}) {
  const text = clean(body.text ?? body.message, MAX_MESSAGE)
  if (!text) throw fail('Please write your message before sending it', 'text')
  return { text }
}

/**
 * Validate how many days of course access an admin is handing back. A year is
 * the most anyone may give in one go, because a year is what the plan itself is
 * worth — anything longer should be a fresh purchase, not a support decision.
 */
export function validateGrant(body = {}) {
  const days = Number(body.days)
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw fail('Enter how many days of access to give, as a whole number from 1 to 365', 'days')
  }
  return { days }
}

const toMessageDTO = (m) => ({
  from: m.from,
  authorName: m.authorName,
  text: m.text,
  at: m.at,
})

/** What the student sees: their own thread, and nothing about who handled it. */
export function toTicketDTO(t) {
  return {
    id: String(t._id),
    subject: t.subject,
    category: t.category,
    product: t.product,
    status: t.status,
    messages: (t.messages || []).map(toMessageDTO),
    lastMessageAt: t.lastMessageAt,
    resolvedAt: t.resolvedAt,
    // Only the shape of the grant, so the student can see their course was
    // reopened and for how long. `days` is the total across every time it was
    // reopened on this ticket, and grantCount says how many times that was, so
    // the page can word it truthfully when it happened more than once.
    accessGrant: {
      days: t.accessGrant?.days || 0,
      grantedAt: t.accessGrant?.grantedAt || null,
      grantCount: (t.grants || []).length,
    },
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }
}

/**
 * What the panel sees: the same thread plus who it belongs to. `user` is
 * populated with name/email by the admin queries; when it is not, the id alone
 * is still returned so the row never renders blank.
 */
export function toTicketAdminDTO(t) {
  const u = t.user
  const populated = u && typeof u === 'object' && u._id
  return {
    ...toTicketDTO(t),
    student: {
      id: String(populated ? u._id : u),
      name: populated ? u.name : '',
      email: populated ? u.email : '',
    },
    resolvedBy: t.resolvedBy ? String(t.resolvedBy) : null,
    accessGrant: {
      // `days` is the running total across every grant on this ticket, not the
      // size of the last one, so the panel has to say "in total" when it shows
      // it. grantCount is how the panel knows whether to say "twice" at all.
      days: t.accessGrant?.days || 0,
      grantedAt: t.accessGrant?.grantedAt || null,
      grantedBy: t.accessGrant?.grantedBy ? String(t.accessGrant.grantedBy) : null,
      grantCount: (t.grants || []).length,
    },
    // The grants one by one, so the thread can mark each note that announced
    // one rather than only the most recent.
    grants: (t.grants || []).map((g) => ({
      days: g.days || 0,
      grantedAt: g.grantedAt || null,
      grantedBy: g.grantedBy ? String(g.grantedBy) : null,
      newExpiry: g.newExpiry || null,
    })),
    // The list screen shows how long a thread has run without opening it.
    messageCount: (t.messages || []).length,
  }
}
