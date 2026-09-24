import { Settings } from './settings.model.js'
import { EMAIL_RE, LIMITS, optionalLink, str } from '../../../utils/validate.js'
import { mediaUrl } from '../../../config/uploads.js'

const KEY = 'site'

/** The settings document, created with its defaults the first time it is asked for. */
export async function getSettings() {
  const found = await Settings.findOne({ key: KEY })
  if (found) return found
  return Settings.create({ key: KEY })
}

/**
 * Who should be emailed about a new enquiry. Admin panel first, then the env
 * var, then the seed admin — so notifications keep working even before anyone
 * has opened the settings screen.
 */
export async function enquiryRecipients() {
  const s = await getSettings().catch(() => null)
  const raw = s?.enquiryTo || process.env.ENQUIRY_TO || process.env.SEED_ADMIN_EMAIL || ''
  return String(raw)
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
}

/**
 * The psychometric guide videos, as playable URLs, for the student's test card.
 * Null for one that has not been set, which the card reads as "skip it".
 */
export async function psychometricGuides() {
  const s = await getSettings().catch(() => null)
  return {
    test: mediaUrl(s?.psychometricTestVideo) || null,
    report: mediaUrl(s?.psychometricReportVideo) || null,
  }
}

/** Update the settings. Only known fields are accepted; the rest are ignored. */
export async function updateSettings(patch = {}, adminId = null) {
  const next = {}

  if (patch.enquiryTo != null) {
    // Ten addresses is more than any team needs on one alias, and each is held to
    // the site's one email rule. The count cap is what stops the field being used
    // as a mailing list: every enquiry is sent to all of them.
    const list = str(patch.enquiryTo, LIMITS.email * 10 + 20)
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10)
    const bad = list.find((e) => !EMAIL_RE.test(e) || e.length > LIMITS.email)
    if (bad) {
      const err = new Error(`"${bad}" is not a valid email address`)
      err.status = 400
      err.field = 'enquiryTo'
      throw err
    }
    next.enquiryTo = list.join(', ')
  }

  // The student's browser plays these, so only an http(s) link or a path on
  // this site is kept — the same rule as every other link a student clicks.
  for (const field of ['psychometricTestVideo', 'psychometricReportVideo']) {
    if (patch[field] != null) next[field] = optionalLink(patch[field], { field })
  }

  next.updatedBy = adminId
  return Settings.findOneAndUpdate({ key: KEY }, next, { new: true, upsert: true })
}
