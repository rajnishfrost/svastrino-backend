import { Enquiry } from './enquiry.model.js'
import { sendEnquiryEmail } from '../../../utils/mailer.js'
import { enquiryRecipients } from '../../admin/settings/settings.service.js'

/**
 * Save an enquiry, then tell the team about it. The email is best-effort: an
 * SMTP failure must never lose the enquiry or show the visitor an error, since
 * the record is already safely stored by then.
 */
export async function createEnquiry(data, { userId = null, ip = '' } = {}) {
  const enquiry = await Enquiry.create({ ...data, user: userId, ip })

  try {
    // Recipients are set in the admin panel (Settings), falling back to the
    // ENQUIRY_TO / SEED_ADMIN_EMAIL env vars.
    const to = await enquiryRecipients()
    if (to.length) await sendEnquiryEmail(to.join(', '), data)
    else console.warn('✗ Enquiry saved but not emailed: no recipient set in Settings or ENQUIRY_TO')
  } catch (err) {
    console.error('✗ Failed to email the enquiry:', err.message)
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

/** Admin: move an enquiry along, or leave a note on it. */
export async function updateEnquiry(id, { status, notes } = {}) {
  const patch = {}
  if (status && ['new', 'contacted', 'closed'].includes(status)) patch.status = status
  if (notes != null) patch.notes = String(notes).slice(0, 2000)
  const e = await Enquiry.findByIdAndUpdate(id, patch, { new: true })
  if (!e) {
    const err = new Error('Enquiry not found')
    err.status = 404
    throw err
  }
  return e
}
