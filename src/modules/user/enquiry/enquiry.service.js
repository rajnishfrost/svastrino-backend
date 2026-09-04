import { Enquiry } from './enquiry.model.js'
import { sendEnquiryEmail, sendEnquiryAckEmail, sendExpertApprovalEmail } from '../../../utils/mailer.js'
import { enquiryRecipients } from '../../admin/settings/settings.service.js'

/**
 * Save an enquiry, then write to both the people it concerns: the team, who have
 * to act on it, and the sender, who has just handed their details to a page they
 * may never open again and deserves something in their inbox saying it arrived.
 *
 * Every send here is best-effort and separately guarded. The record is already
 * stored by this point, so an SMTP failure must never lose the enquiry or show
 * the visitor an error — and the team's copy failing must not cost the sender
 * their receipt, or the other way round.
 */
export async function createEnquiry(data, { userId = null, ip = '' } = {}) {
  const enquiry = await Enquiry.create({ ...data, user: userId, ip })

  try {
    // Recipients are read fresh on every enquiry, so changing them in the admin
    // panel takes effect immediately. Settings first, then the ENQUIRY_TO /
    // SEED_ADMIN_EMAIL env vars.
    const to = await enquiryRecipients()
    if (to.length) await sendEnquiryEmail(to.join(', '), data)
    else console.warn('✗ Enquiry saved but not emailed: no recipient set in Settings or ENQUIRY_TO')
  } catch (err) {
    console.error('✗ Failed to email the enquiry to the team:', err.message)
  }

  // The sender's receipt. Guarded by having an address at all: the contact form
  // has always required one, and both the other forms now do too, but an older
  // caller could still post without one and that is not worth an exception.
  if (data.email) {
    try {
      await sendEnquiryAckEmail(data.email, data)
    } catch (err) {
      console.error(`✗ Enquiry ${enquiry._id} saved, but could not acknowledge it to ${data.email}:`, err.message)
    }
  }

  return enquiry
}

/** Admin list, newest first. */
export async function listEnquiries({ status, source } = {}) {
  const q = {}
  if (status) q.status = status
  if (source) q.source = source
  return Enquiry.find(q).sort({ createdAt: -1 }).limit(500)
}

const STATUSES = ['new', 'contacted', 'approved', 'closed']

/**
 * Admin: move an enquiry along, or leave a note on it.
 *
 * Approving an expert-call request is what actually opens the checkout for that
 * program, so it also stamps the time and mails the caller their booking
 * link. The mail is best-effort — the approval itself is what matters.
 */
export async function updateEnquiry(id, { status, notes } = {}) {
  const before = await Enquiry.findById(id)
  if (!before) {
    const err = new Error('Enquiry not found')
    err.status = 404
    throw err
  }

  const patch = {}
  if (status && STATUSES.includes(status)) patch.status = status
  if (notes != null) patch.notes = String(notes).slice(0, 2000)

  const newlyApproved = patch.status === 'approved' && before.status !== 'approved'
  if (newlyApproved) patch.approvedAt = new Date()

  const e = await Enquiry.findByIdAndUpdate(id, patch, { new: true })

  if (newlyApproved) {
    if (e.email) {
      try {
        await sendExpertApprovalEmail(e.email, { name: e.name, program: e.program })
      } catch (err) {
        console.error('✗ Approved, but could not email the booking link:', err.message)
      }
    } else {
      // The expert-call form only insists on a phone number, so plenty of
      // approvals have no address to write to. Say so loudly rather than let the
      // approval look sent — somebody has to pass the booking link on by phone.
      console.warn(
        `✗ Enquiry ${e._id} approved with no email address: no booking link was sent. Call ${e.phone || 'them'} instead.`
      )
    }
  }

  return e
}

/**
 * Both sides of a phone comparison are free text: the form accepts spaces,
 * hyphens and an optional country code, and nobody writes their number the same
 * way twice. So match on the last ten digits, allowing any separator between
 * them, which makes '+91 98765 43210' and '9876543210' the same person. Fewer
 * than ten digits is too weak to identify anyone, so it is ignored rather than
 * risk clearing the wrong buyer.
 */
function phoneTailPattern(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length < 10) return null
  return new RegExp(`${digits.slice(-10).split('').join('\\D*')}$`)
}

/**
 * Every way the same person can be recognised across their enquiries: the
 * account they are signed into, the address they typed, the number they left.
 *
 * Shared by the approval gate and the "where does my request stand" lookup so
 * the two can never disagree — a request the checkout counts as approved must
 * be the same request the page shows them, or the page will say "not yet" over
 * a checkout that is already open.
 */
async function identityClauses({ userId, email, phone }) {
  let buyerEmail = email
  let buyerPhone = phone
  if (userId && (!buyerEmail || !buyerPhone)) {
    // Lazy import so payments never loads the auth stack to price a package.
    const { User } = await import('../credentials/credentials.model.js')
    const account = await User.findById(userId).select('email phone')
    buyerEmail = buyerEmail || account?.email
    buyerPhone = buyerPhone || account?.phone
  }

  const or = []
  if (userId) or.push({ user: userId })
  if (buyerEmail) or.push({ email: String(buyerEmail).toLowerCase().trim() })
  const phonePattern = phoneTailPattern(buyerPhone)
  if (phonePattern) or.push({ phone: phonePattern })
  return or
}

/**
 * The enquiry this person most recently sent from one form, or null.
 *
 * Drives what the public forms show a signed-in visitor. A form that has already
 * been answered should not sit there blank pretending nothing happened: on the
 * program pages it is a step in buying (the checkout stays shut until the team
 * approves the call), so what they need to see is where their request stands,
 * not another empty form to fill in twice.
 *
 * 'closed' requests are skipped deliberately. A closed enquiry is finished
 * business, and someone coming back months later with a new question should get
 * a form, not a receipt for an old one.
 */
export async function myLatestEnquiry({ userId, source, program } = {}) {
  const or = await identityClauses({ userId })
  if (!or.length) return null

  const query = { status: { $ne: 'closed' }, $or: or }
  if (source) query.source = source
  if (program) query.program = program

  return Enquiry.findOne(query)
    .sort({ createdAt: -1 })
    .select('status source program createdAt')
}

/**
 * Has this person been cleared to buy `program` after their call?
 *
 * Matched on the account, then the email address, then the phone number,
 * because most callers fill the form as a guest and only create an account when
 * they come back to pay. The phone branch is not a nicety: the expert-call form
 * makes the email optional and only demands a phone number, so for those callers
 * it is the one thing that can ever tie their approved enquiry to the account
 * they pay from.
 */
export async function isApprovedForProgram({ userId, email, phone, program }) {
  if (!program) return false

  // Callers hand us whichever details they happen to be holding; identityClauses
  // fills in the rest from the account rather than making every caller widen its
  // own query.
  const or = await identityClauses({ userId, email, phone })
  if (!or.length) return false

  const hit = await Enquiry.findOne({
    source: 'expert-call',
    program,
    status: 'approved',
    $or: or,
  }).select('_id')
  return !!hit
}
