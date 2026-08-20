import { Settings } from './settings.model.js'

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Update the settings. Only known fields are accepted; the rest are ignored. */
export async function updateSettings(patch = {}, adminId = null) {
  const next = {}

  if (patch.enquiryTo != null) {
    const list = String(patch.enquiryTo)
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)
    const bad = list.find((e) => !EMAIL_RE.test(e))
    if (bad) {
      const err = new Error(`"${bad}" is not a valid email address`)
      err.status = 400
      err.field = 'enquiryTo'
      throw err
    }
    next.enquiryTo = list.join(', ')
  }

  next.updatedBy = adminId
  return Settings.findOneAndUpdate({ key: KEY }, next, { new: true, upsert: true })
}
