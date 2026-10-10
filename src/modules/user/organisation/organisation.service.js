import crypto from 'node:crypto'
import { Organisation, ORG_TYPES, ORG_MODULES, DEFAULT_ORG_MODULES } from './organisation.model.js'
import { User } from '../credentials/credentials.model.js'
import { accountStatus, AUTH_STATUS_FIELDS } from '../credentials/accountStatus.js'
import { provisionAccount } from '../credentials/credentials.service.js'
import { parseCsvRecords, buildCsv } from '../../../utils/csv.js'
import { sendOrgApprovedEmail, sendStudentInviteEmail } from '../../../utils/mailer.js'
import { Enrollment } from '../payments/enrollment.model.js'
import { normalisePackageSkus, sponsoredCourses, grantSponsoredPackages, rosterCourseProgress } from './sponsorship.js'
import { pageOf, pageResult } from '../../../utils/paginate.js'
import {
  EMAIL_RE, LIMITS, optionalPhone, optionalPincode, optionalUrl, str as sstr,
} from '../../../utils/validate.js'
import { seatsUsed, seatSummary } from './seats.js'
import { canEncrypt, encryptSecret, decryptSecret } from '../../../utils/secretBox.js'

const httpError = (message, status, code) => {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

// The shared normaliser under its historic local name, so every call site below
// reads as it always did. It strips markup and invisible characters as well as
// truncating — see utils/validate.js.
const str = sstr
const isEmail = (s) => EMAIL_RE.test(s)

/**
 * How long each profile field may be.
 *
 * Read from the shared LIMITS rather than written out here, because the browser's
 * maxLength attributes read from the same object: a number typed twice is a number
 * that eventually disagrees with itself, and when it does the visible symptom is a
 * form that silently loses the tail of what somebody typed.
 */
const PROFILE_CAPS = {
  name: LIMITS.title,
  description: LIMITS.description,
  branch: LIMITS.title,
  address: LIMITS.address,
  city: LIMITS.city,
  state: LIMITS.state,
  contactPerson: LIMITS.name,
}

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const clientUrl = () =>
  (process.env.CLIENT_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5174').replace(/\/$/, '')

// ---- Organisation codes -----------------------------------------------------

/** DPS-RKP → "DPSRKP"; falls back to "ORG" for names with no letters. */
const initials = (name) =>
  String(name || '')
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, '').charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 5) || 'ORG'

/** A short, unique, human-readable handle: DPS-4F2A. Retried on collision. */
async function generateCode(name) {
  for (let i = 0; i < 8; i++) {
    const code = `${initials(name)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
    if (!(await Organisation.exists({ code }))) return code
  }
  // Astronomically unlikely; fall back to a longer random tail.
  return `${initials(name)}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
}

// ---- Shaping ----------------------------------------------------------------

/** Everything a public visitor may see about an organisation. */
export const publicOrgDTO = (o) => ({
  id: o._id,
  name: o.name,
  type: o.type,
  description: o.description || '',
  branch: o.branch || '',
  city: o.city || '',
  state: o.state || '',
  website: o.website || '',
  code: o.code || '',
  label: [o.name, o.branch, o.city].filter(Boolean).join(' · '),
})

/** Adds the contact + status columns only staff (or the org itself) may see. */
export const fullOrgDTO = (o) => ({
  ...publicOrgDTO(o),
  address: o.address || '',
  pincode: o.pincode || '',
  contactPerson: o.contactPerson || '',
  phone: o.phone || '',
  email: o.email,
  status: o.status,
  rejectionReason: o.rejectionReason || '',
  owner: o.owner || null,
  modules: o.modules || [],
  packages: o.packages || [],
  seats: o.seats ?? null,
  awaitingPayment: !!o.awaitingPayment,
  publicListed: !!o.publicListed,
  active: o.active !== false,
  reviewedAt: o.reviewedAt || null,
  createdAt: o.createdAt,
})

/**
 * The institution's Mindler account as staff see it: never the password, only
 * whether one is saved. Not part of fullOrgDTO, which the institution's own
 * portal receives too.
 */
export const mindlerDTO = (o) => ({
  loginId: o.mindler?.loginId || '',
  schoolId: o.mindler?.schoolId || '',
  passwordSetAt: o.mindler?.passwordSetAt || null,
})

/** fullOrgDTO plus what only our admin may see. */
export const adminOrgDTO = (o) => ({ ...fullOrgDTO(o), mindler: mindlerDTO(o) })

// ---- Mindler account --------------------------------------------------------

const MINDLER_CAPS = { loginId: LIMITS.email, password: 200, schoolId: 40 }

/**
 * Check and normalise the Mindler fields an admin typed: { loginId, password,
 * schoolId }. The school id stands on its own — it can be set before the
 * institution has a login. A blank password means "keep the saved one". Clearing the login
 * clears the password with it — a password for no account is no use to anyone.
 * Throws before anything is written, so a bad field never half-saves a form.
 */
function cleanMindler(m) {
  if (m == null) return null
  if (typeof m !== 'object' || Array.isArray(m)) throw httpError('Mindler details must be an object', 400)
  const loginId = String(m.loginId ?? '').trim().toLowerCase().slice(0, MINDLER_CAPS.loginId)
  const password = typeof m.password === 'string' ? m.password : ''
  const schoolId = String(m.schoolId ?? '').trim().slice(0, MINDLER_CAPS.schoolId)
  if (schoolId && !/^[A-Za-z0-9_-]+$/.test(schoolId)) throw httpError('The Mindler school ID may only hold letters, digits, - and _', 400)
  if (loginId && !isEmail(loginId)) throw httpError('The Mindler login must be an email address', 400)
  if (password.length > MINDLER_CAPS.password) throw httpError('That Mindler password is too long', 400)
  if (password && !loginId) throw httpError('Enter the Mindler login along with its password', 400)
  if (password && !canEncrypt()) {
    throw httpError('Saving passwords is not set up on this server yet (CREDENTIALS_ENCRYPTION_KEY is missing).', 503, 'ENCRYPTION_NOT_CONFIGURED')
  }
  return { loginId, password, schoolId }
}

/** Validate the Mindler part of a draft without writing anything. */
export function assertMindlerDraft(m) {
  cleanMindler(m)
}

/**
 * Write cleaned Mindler fields onto an organisation document (not saved).
 * Returns true when the school id changed, so the caller can pass it on to the
 * students already on the roster once the organisation is saved.
 */
function applyMindler(org, m) {
  const clean = cleanMindler(m)
  if (!clean) return false
  const schoolChanged = (org.mindler?.schoolId || '') !== clean.schoolId
  org.set('mindler.schoolId', clean.schoolId)
  org.set('mindler.loginId', clean.loginId)
  if (!clean.loginId) {
    org.set('mindler.password', '')
    org.set('mindler.passwordSetAt', null)
  } else if (clean.password) {
    org.set('mindler.password', encryptSecret(clean.password))
    org.set('mindler.passwordSetAt', new Date())
  }
  return schoolChanged
}

/** The value a student of this organisation carries in User.mindlerSchoolId. */
const studentSchoolId = (org) => org?.mindler?.schoolId || null

/**
 * Give every student on the roster the organisation's current school id —
 * after it changes, so students added before it was set (or under an old id)
 * reach Mindler under the right school from their next test on.
 */
async function syncRosterSchoolId(org) {
  await User.updateMany(
    { organisation: org._id, organisationRole: 'member' },
    { $set: { mindlerSchoolId: studentSchoolId(org) } }
  )
}

/**
 * The institution's Mindler sign-in, decrypted, for the server's own use when
 * signing the institution in to Mindler. Null when none is saved or it cannot
 * be opened. Never send the result to a browser.
 */
export async function mindlerCredentials(orgId) {
  const org = await Organisation.findById(orgId).select('+mindler.password')
  if (!org?.mindler?.loginId) return null
  const password = decryptSecret(org.mindler.password)
  return { loginId: org.mindler.loginId, schoolId: org.mindler.schoolId || '', password }
}

// ---- Partner application (public form) --------------------------------------

/** Public form submission. One application per client IP, as before. */
export async function submitApplication(body, ip) {
  const name = str(body.name, LIMITS.title)
  const email = String(body.email || '').trim().toLowerCase()
  const type = ORG_TYPES.includes(body.type) ? body.type : 'school'
  if (!name) throw httpError('Organisation name is required', 400)
  if (!isEmail(email)) throw httpError('Enter a valid email', 400)

  // One submission per IP (trust-proxy is on, so req.ip is the real client).
  if (ip && (await Organisation.exists({ submittedIp: ip }))) {
    throw httpError('A request has already been submitted from this network.', 409, 'IP_ALREADY_SUBMITTED')
  }
  if (await Organisation.exists({ email })) {
    throw httpError('An organisation with this email has already applied.', 409, 'EMAIL_ALREADY_APPLIED')
  }

  const fields = {}
  for (const [field, max] of Object.entries(PROFILE_CAPS)) fields[field] = str(body[field], max)

  return Organisation.create({
    ...fields,
    name,
    type,
    pincode: optionalPincode(body.pincode),
    website: optionalUrl(body.website, { field: 'website' }),
    phone: optionalPhone(body.phone),
    email,
    submittedIp: ip || '',
    status: 'pending',
  })
}

// ---- Admin: listing & review -------------------------------------------------

export async function listOrganisations({ status, type, q, page, limit } = {}) {
  const filter = {}
  if (status && ['pending', 'approved', 'rejected'].includes(status)) filter.status = status
  if (type && ORG_TYPES.includes(type)) filter.type = type
  if (q) {
    const rx = new RegExp(escapeRegExp(q), 'i')
    filter.$or = [{ name: rx }, { email: rx }, { city: rx }, { state: rx }, { code: rx }]
  }
  const p = pageOf({ page, limit })
  const [items, total] = await Promise.all([
    Organisation.find(filter)
      .collation({ locale: 'en', strength: 2 })
      .sort({ name: 1, branch: 1 })
      .skip(p.skip)
      .limit(p.limit),
    Organisation.countDocuments(filter),
  ])
  return pageResult(items, total, p)
}

export async function getOrganisation(id) {
  const org = await Organisation.findById(id)
  if (!org) throw httpError('Organisation not found', 404)
  return org
}

// ---- Admin-created organisations (Users page → role "Organisation") ---------
// The public route is apply → approve. An admin onboarding a partner directly
// skips both: they type the organisation's details alongside the login, and it
// lands already approved. These two helpers are what the account-creation
// service calls so validation happens BEFORE the User row is written.

/**
 * Validate the organisation half of a "new organisation account" form. Throws
 * the same 400s the public form would, so the admin sees a real message rather
 * than a Mongoose validation dump.
 */
export function assertOrganisationDraft(draft, ownerEmail) {
  const d = draft || {}
  if (!str(d.name, PROFILE_CAPS.name)) throw httpError('Organisation name is required', 400)
  if (d.type && !ORG_TYPES.includes(d.type)) throw httpError('Pick a valid organisation type', 400)
  const email = String(d.email || ownerEmail || '').trim().toLowerCase()
  if (!isEmail(email)) throw httpError('The organisation needs a valid contact email', 400)
  if (d.packages !== undefined && !Array.isArray(d.packages)) {
    throw httpError('Sponsored courses must be a list of package SKUs', 400)
  }
  assertMindlerDraft(d.mindler)
}

/**
 * Create an approved, active organisation owned by `owner`. Assumes
 * assertOrganisationDraft already passed. The owner link itself is set by the
 * caller, which owns the rollback if anything here fails.
 */
export async function createOrganisationForOwner(owner, draft = {}) {
  const email = String(draft.email || owner.email).trim().toLowerCase()
  if (await Organisation.exists({ email })) {
    throw httpError('An organisation with this email already exists', 409)
  }
  // The same caps as the organisation's own profile form and the public partner
  // application, from the one table, so an organisation created by an admin holds
  // fields of the same shape as one that applied for itself.
  const fields = {}
  for (const [field, max] of Object.entries(PROFILE_CAPS)) fields[field] = str(draft[field], max)
  const name = fields.name
  const org = new Organisation({
    ...fields,
    type: ORG_TYPES.includes(draft.type) ? draft.type : 'school',
    pincode: optionalPincode(draft.pincode),
    website: optionalUrl(draft.website, { field: 'website' }),
    contactPerson: fields.contactPerson || owner.name || '',
    phone: optionalPhone(draft.phone),
    email,
    code: await generateCode(name),
    // Admin typed these details in person — no review step to wait for.
    status: 'approved',
    reviewedAt: new Date(),
    owner: owner._id,
    modules: [...DEFAULT_ORG_MODULES],
    packages: await normalisePackageSkus(draft.packages),
    publicListed: draft.publicListed !== false,
    active: true,
  })
  applyMindler(org, draft.mindler)
  return org.save()
}

/** Does this account own an organisation? Used by the account-edit guards. */
export async function organisationOwnedBy(userId) {
  return Organisation.findOne({ owner: userId })
}

/**
 * The student accounts on an institution's roster — what deleting the
 * institution deletes with it.
 */
export async function institutionMemberIds(org) {
  return User.find({ organisation: org._id, organisationRole: 'member' }).distinct('_id')
}

/**
 * Delete the institution record itself, and its orders, once its students
 * have been deleted (see deleteManagedAccount). Nothing of it is left behind.
 * Students it had already removed are no longer its students and keep their
 * accounts; only their "removed from" marker, which would now point at
 * nothing, is cleared.
 */
export async function deleteInstitution(org) {
  const { Order } = await import('../payments/order.model.js')
  await Order.deleteMany({ organisation: org._id })
  await User.updateMany(
    { removedFromOrganisation: org._id },
    { $set: { removedFromOrganisation: null, removedFromOrganisationAt: null } }
  )
  await org.deleteOne()
}

/**
 * Approve or reject an application.
 *
 * On approval we also stand the organisation up end-to-end: assign a code,
 * create (or upgrade) its owner User account with role 'organisation', and email
 * a set-password link to the portal. Re-approving an already-approved
 * organisation is a no-op on the account — it never gets a second owner.
 */
export async function reviewOrganisation(adminId, id, { status, reason } = {}) {
  if (!['approved', 'rejected'].includes(status)) throw httpError('Invalid status', 400)
  const org = await Organisation.findById(id)
  if (!org) throw httpError('Organisation not found', 404)

  org.status = status
  org.rejectionReason = status === 'rejected' ? str(reason, 300) : ''
  org.reviewedBy = adminId
  org.reviewedAt = new Date()

  if (status !== 'approved') {
    await org.save()
    return org
  }

  if (!org.code) org.code = await generateCode(org.name)
  if (!org.modules?.length) org.modules = [...DEFAULT_ORG_MODULES]

  // The owner account. `upgradeExisting` because the contact may already have a
  // student account — we promote it rather than refusing or duplicating.
  let link = null
  if (!org.owner) {
    const { user, link: setPw } = await provisionAccount({
      email: org.email,
      name: org.contactPerson || org.name,
      phone: org.phone,
      role: 'organisation',
      organisation: org._id,
      organisationRole: 'owner',
      upgradeExisting: true,
    })
    org.owner = user._id
    link = setPw
  }
  await org.save()

  sendOrgApprovedEmail(org.email, {
    name: org.contactPerson || org.name,
    organisation: org.name,
    code: org.code,
    // Already has a password (an existing account we promoted) → send them to
    // the portal instead of a pointless set-password link.
    link: link || `${clientUrl()}/organisation`,
  }).catch((e) => console.error('✗ organisation approval email failed:', e.message))

  return org
}

/** Admin edits: profile fields, granted portal modules, listing + suspension. */
export async function updateOrganisationByAdmin(id, body = {}) {
  const org = await Organisation.findById(id)
  if (!org) throw httpError('Organisation not found', 404)

  applyProfileFields(org, body)
  if (body.type !== undefined && ORG_TYPES.includes(body.type)) org.type = body.type
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase()
    if (!isEmail(email)) throw httpError('Enter a valid email', 400)
    if (await Organisation.exists({ _id: { $ne: org._id }, email })) {
      throw httpError('Another organisation already uses this email', 409)
    }
    org.email = email
  }
  if (body.modules !== undefined) {
    if (!Array.isArray(body.modules)) throw httpError('Modules must be a list', 400)
    org.modules = [...new Set(body.modules.filter((m) => ORG_MODULES.includes(m)))]
  }
  // A change here reaches only students who claim their account from now on;
  // seats already granted are enrollments in their own right and stay.
  if (body.packages !== undefined) org.packages = await normalisePackageSkus(body.packages)
  if (body.publicListed !== undefined) org.publicListed = !!body.publicListed
  if (body.active !== undefined) org.active = !!body.active
  const schoolChanged = body.mindler !== undefined && applyMindler(org, body.mindler)

  await org.save()
  if (schoolChanged) await syncRosterSchoolId(org)
  return org
}

/** Profile fields an organisation may edit about itself (shared with admin). */
function applyProfileFields(org, body) {
  for (const [field, max] of Object.entries(PROFILE_CAPS)) {
    if (body[field] !== undefined) org[field] = str(body[field], max)
  }
  if (body.name !== undefined && !org.name) throw httpError('Organisation name is required', 400)
  // The three that are checked rather than merely capped: a number somebody will
  // ring, a link somebody will click, and a PIN code that is digits or nothing.
  if (body.phone !== undefined) org.phone = optionalPhone(body.phone)
  if (body.website !== undefined) org.website = optionalUrl(body.website, { field: 'website' })
  if (body.pincode !== undefined) org.pincode = optionalPincode(body.pincode)
}

// ---- Public directory --------------------------------------------------------

/** /organisations — approved, active, and opted in to being listed. */
export async function publicDirectory({ q, type, state } = {}) {
  const filter = { status: 'approved', active: true, publicListed: true }
  if (type && ORG_TYPES.includes(type)) filter.type = type
  if (state) filter.state = new RegExp(`^${escapeRegExp(state)}$`, 'i')
  if (q) {
    const rx = new RegExp(escapeRegExp(q), 'i')
    filter.$or = [{ name: rx }, { city: rx }, { state: rx }, { description: rx }]
  }
  return Organisation.find(filter)
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1, branch: 1 })
    .select('name type description branch city state website code')
    .limit(500)
}

/** Distinct states across listed organisations — powers the directory filter. */
export async function directoryStates() {
  const states = await Organisation.distinct('state', {
    status: 'approved',
    active: true,
    publicListed: true,
    state: { $nin: ['', null] },
  })
  return states.sort((a, b) => a.localeCompare(b))
}

/** Approved + active organisations — the student enrollment dropdown. */
export async function enrollableOrganisations() {
  return Organisation.find({ status: 'approved', active: true })
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1, branch: 1 })
    .select('name type branch city state code')
}

// ---- Students ----------------------------------------------------------------

// The columns an organisation fills in. `email` is the identity; the rest is
// roster detail. Section and roll number are deliberately NOT asked for: they
// are the school's own filing, they change every year, and nothing on the
// student's side of the site ever shows them. A shorter template is a template
// people fill in correctly.
const CSV_HEADERS = ['name', 'email', 'phone', 'class']

/** The downloadable template, with two filled example rows to copy. */
export function sampleCsv() {
  return buildCsv(CSV_HEADERS, [
    ['Aarav Sharma', 'aarav.sharma@example.com', '9876543210', '10'],
    ['Diya Verma', 'diya.verma@example.com', '9812345678', '12'],
  ])
}

/** Every account attached to this organisation. */
export async function listOrgStudents(orgId, { q } = {}) {
  const filter = { organisation: orgId, organisationRole: 'member' }
  // Capped before it becomes a pattern. `q` arrives from a query string, which
  // express parses with qs — so it can be an object, and RegExp(object) is not a
  // search, it is a 500.
  const term = str(q, LIMITS.search)
  if (term) {
    const rx = new RegExp(escapeRegExp(term), 'i')
    filter.$or = [{ name: rx }, { email: rx }]
  }
  // Both auth fields, not just the password: accountStatus needs googleId too,
  // and a projection that leaves it out reports a live Google account as invited.
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(2000).select(AUTH_STATUS_FIELDS)

  // The sponsored course, per student: granted (the row exists), or still
  // waiting on them to claim the account. Null when nothing is sponsored, so
  // a scholarship-only roster shows no course column at all.
  const org = await Organisation.findById(orgId).select('packages')
  const sponsored = await sponsoredCourses(org)
  const grantedTo = new Set(
    sponsored.length
      ? (await Enrollment.find({ user: { $in: users.map((u) => u._id) }, sponsoredBy: orgId })
          .select('user')).map((e) => String(e.user))
      : []
  )
  const progressOf = await rosterCourseProgress(org, users.map((u) => u._id))
  const courseOf = (u) => sponsored.length
    ? {
        names: sponsored.map((c) => c.name),
        status: grantedTo.has(String(u._id)) ? 'granted' : 'pending',
        // How far along, and whether they are keeping the one-step-a-day pace.
        progress: progressOf.get(String(u._id)) || null,
      }
    : null

  return users.map((u) => {
    return {
      id: u._id,
      name: u.name || '—',
      email: u.email,
      phone: u.phone || '',
      studentClass: u.studentClass || '',
      // Has the student claimed the account we created for them? Answered by the
      // one shared rule, so this roster and the admin panel cannot describe the
      // same person differently — and so a student who claimed their invite with
      // GOOGLE stops reading as "Invite sent" for ever, which is what asking
      // about a password alone used to do to them.
      status: accountStatus(u),
      activated: accountStatus(u) === 'active',
      course: courseOf(u),
      addedAt: u.createdAt,
    }
  })
}

/**
 * Add one student: provision the account and attach it to the organisation.
 * Shared by the single-add form and the CSV importer so both behave identically.
 */
async function addStudent(org, row) {
  const email = String(row.email || '').trim().toLowerCase()
  if (!isEmail(email)) throw httpError('Enter a valid email', 400)

  // An institution that has paid for a number of seats can fill only those.
  if (org.seats != null && !(await holdsSeat(org, email)) && (await seatsUsed(org._id)) >= org.seats) {
    throw httpError(noSeatsMessage(org), 409, 'NO_SEATS')
  }

  const { user, created, link, attached } = await provisionAccount({
    email,
    name: str(row.name, LIMITS.name),
    // A roster number comes from a spreadsheet as often as from the portal form,
    // so it is normalised rather than refused: optionalPhone accepts a bare ten
    // digit Indian number and puts +91 in front of it, and turns away anything
    // that is not a plausible number at all.
    phone: optionalPhone(row.phone) || undefined,
    // The class belongs on the ACCOUNT: it is what the student sees in
    // Settings, and what the psychometric plan checks their year against.
    studentClass: str(row.class, LIMITS.studentClass) || undefined,
    organisation: org._id,
    organisationRole: 'member',
    // The organisation's own login is who added them — that is the answer the
    // admin panel shows under "Created by", and "Self" would be a lie here.
    createdBy: org.owner || null,
  })

  // Belongs to someone else already — never steal them, just report it.
  if (String(user.organisation || '') !== String(org._id)) {
    return { user, status: 'conflict', message: 'Already belongs to another institute' }
  }

  // The institution's Mindler school, so the test files them under it.
  if ((user.mindlerSchoolId || null) !== studentSchoolId(org)) {
    user.mindlerSchoolId = studentSchoolId(org)
    await user.save()
  }

  // Adding back a student this organisation had removed. The removal switched
  // off an account the organisation had made; asking for them again is the
  // organisation's own undo, so the login comes back with the roster place.
  if (user.removedFromOrganisation) {
    if (user.signupMethod === 'invite' && user.active === false) user.active = true
    user.removedFromOrganisation = null
    user.removedFromOrganisationAt = null
    await user.save()
  }

  // A roster import may carry a newer class than the account was created with.
  if (row.class && user.studentClass !== str(row.class, LIMITS.studentClass)) {
    user.studentClass = str(row.class, LIMITS.studentClass)
    await user.save()
  }

  // The sponsored course lands when the student claims the account. One who
  // already had a live account — a password, or Google — has nothing left to
  // claim, so for them that moment is now. Re-read with both auth fields:
  // provisionAccount selects the password but not googleId, and judging on
  // the password alone would leave a Google student waiting for ever.
  if (org.packages?.length) {
    const live = await User.findById(user._id).select(AUTH_STATUS_FIELDS)
    if (accountStatus(live) === 'active') await grantSponsoredPackages(live)
  }

  return {
    user,
    link,
    status: created ? 'created' : attached ? 'linked' : 'existing',
    message: created
      ? 'Account created'
      : attached
        ? 'Existing account linked to your institute'
        : 'Already a member',
  }
}

const noSeatsMessage = (org) =>
  `All ${org.seats} seat${org.seats === 1 ? ' is' : 's are'} taken. Ask the Svastrino team for more seats to add another student.`

/**
 * Whether this email already counts against the institution's seats: a student
 * on its roster now, or one who left after receiving its course. Adding them
 * again takes no new seat.
 */
async function holdsSeat(org, email) {
  const existing = await User.findOne({ email }).select('organisation organisationRole')
  if (!existing) return false
  if (String(existing.organisation || '') === String(org._id) && existing.organisationRole === 'member') return true
  return !!(await Enrollment.exists({ user: existing._id, sponsoredBy: org._id }))
}

/** Single manual add from the portal. Sends the invite when it's a new account. */
export async function addOrgStudent(orgId, body) {
  const org = await Organisation.findById(orgId)
  if (!org) throw httpError('Organisation not found', 404)
  const res = await addStudent(org, { ...body, __source: 'org' })
  if (res.status === 'conflict') throw httpError(res.message, 409, 'OTHER_ORGANISATION')
  if (res.link) {
    sendStudentInviteEmail(res.user.email, {
      name: res.user.name,
      organisation: org.name,
      link: res.link,
      courses: (await sponsoredCourses(org)).map((c) => c.name),
    }).catch((e) => console.error(`✗ student invite to ${res.user.email} failed:`, e.message))
  }
  return res
}

const MAX_IMPORT_ROWS = 1000

/**
 * Bulk-import a roster from CSV.
 *
 * Two-phase by design: the portal first calls this with `dryRun` to show the
 * organisation exactly what will happen row by row, then again to commit. The
 * per-row report is identical either way, so the preview never lies.
 *
 * Invite emails are sent sequentially AFTER the writes, so a flaky SMTP server
 * can't leave the import half-applied.
 */
export async function bulkImportStudents(orgId, csvText, { dryRun = false } = {}) {
  const org = await Organisation.findById(orgId)
  if (!org) throw httpError('Organisation not found', 404)

  const { records, rawHeaders = [] } = parseCsvRecords(csvText)
  if (!records.length) throw httpError('That sheet has no students in it. Download the sample sheet and fill it in.', 400)
  if (records.length > MAX_IMPORT_ROWS) {
    throw httpError(`That's ${records.length} rows — please split the sheet into batches of ${MAX_IMPORT_ROWS}.`, 400)
  }
  if (!records[0] || !('email' in records[0])) {
    throw httpError(
      `The sheet has no "email" column. Expected: ${CSV_HEADERS.join(', ')} — found: ${rawHeaders.join(', ') || 'nothing'}`,
      400
    )
  }

  const results = []
  const invites = []
  const seen = new Set() // duplicate emails inside the same file
  // The preview counts seats the way the real import will spend them, so it
  // says up front which rows will not fit.
  let previewUsed = dryRun && org.seats != null ? await seatsUsed(org._id) : 0

  for (const rec of records) {
    const email = String(rec.email || '').trim().toLowerCase()
    const base = { line: rec.__line, name: rec.name || '', email }

    if (!isEmail(email)) { results.push({ ...base, status: 'error', message: 'Invalid or missing email' }); continue }
    if (seen.has(email)) { results.push({ ...base, status: 'skipped', message: 'Listed twice in this sheet' }); continue }
    seen.add(email)

    if (dryRun) {
      const existing = await User.findOne({ email }).select('organisation organisationRole')
      const otherOrg = existing?.organisation && String(existing.organisation) !== String(org._id)
      if (!otherOrg && org.seats != null && !(await holdsSeat(org, email))) {
        if (previewUsed >= org.seats) {
          results.push({ ...base, status: 'error', message: 'No seat left for this student' })
          continue
        }
        previewUsed += 1
      }
      results.push({
        ...base,
        status: otherOrg ? 'conflict' : existing ? 'existing' : 'created',
        message: otherOrg
          ? 'Already belongs to another organisation — will be skipped'
          : existing
            ? 'Account exists — will be linked'
            : 'New account will be created and invited',
      })
      continue
    }

    try {
      const r = await addStudent(org, { ...rec, __source: 'bulk' })
      results.push({ ...base, status: r.status, message: r.message })
      if (r.link) invites.push({ email: r.user.email, name: r.user.name, link: r.link })
    } catch (e) {
      results.push({ ...base, status: 'error', message: e.message })
    }
  }

  // Gentle on SMTP: one at a time, and a failure only affects that student.
  if (!dryRun && invites.length) {
    const courses = (await sponsoredCourses(org)).map((c) => c.name)
    ;(async () => {
      for (const inv of invites) {
        try {
          await sendStudentInviteEmail(inv.email, {
            name: inv.name,
            organisation: org.name,
            link: inv.link,
            courses,
          })
        } catch (e) {
          console.error(`✗ student invite to ${inv.email} failed:`, e.message)
        }
      }
    })().catch(() => {})
  }

  const count = (s) => results.filter((r) => r.status === s).length
  return {
    dryRun,
    total: results.length,
    created: count('created'),
    linked: count('linked'),
    existing: count('existing'),
    conflicts: count('conflict'),
    skipped: count('skipped'),
    errors: count('error'),
    invitesQueued: dryRun ? 0 : invites.length,
    results,
  }
}

/**
 * Detach a student from the organisation. Their account and history survive —
 * only the organisation link is cleared.
 */
export async function removeOrgStudent(orgId, userId) {
  const user = await User.findOne({ _id: userId, organisation: orgId, organisationRole: 'member' })
  if (!user) throw httpError('Student not found in your institute', 404)

  // Remembered so an admin can undo a removal made by mistake (restoreOrgStudent).
  user.removedFromOrganisation = user.organisation
  user.removedFromOrganisationAt = new Date()
  user.organisation = null
  user.organisationRole = null
  // No longer this school's student, so no longer filed under it on Mindler.
  user.mindlerSchoolId = null

  // Switch the account off — but ONLY when this organisation is what brought it
  // into existence. A roster can also pick up somebody who had already signed
  // themselves up, and disabling THAT account would take away a login the
  // person made for themselves and still owns; the organisation is only letting
  // go of a student, not closing their account. An admin can switch a disabled
  // one back on from Users.
  if (user.signupMethod === 'invite') user.active = false

  await user.save()
}

/**
 * Undo a removal: put the student back on the roster of the organisation that
 * let them go. Admin-only — the organisation's own way back is simply to add
 * the student again, and both paths end in the same state. The login is
 * switched back on only where the removal switched it off (an invite-made
 * account); a self-made account was never touched. A sponsored course they
 * did not yet hold lands now, since there is nothing left for them to claim.
 */
export async function restoreOrgStudent(userId) {
  const user = await User.findById(userId).select(AUTH_STATUS_FIELDS)
  if (!user) throw httpError('Student not found', 404)
  // Checked first: after a restore the marker is gone too, and "already
  // belongs" is the answer that tells a second click what actually happened.
  if (user.organisation) throw httpError('This student already belongs to an organisation', 409)
  if (!user.removedFromOrganisation) throw httpError('This student was not removed from an organisation', 400)
  const org = await Organisation.findById(user.removedFromOrganisation)
  if (!org) throw httpError('That organisation no longer exists', 404)

  user.organisation = org._id
  user.organisationRole = 'member'
  user.mindlerSchoolId = studentSchoolId(org)
  user.removedFromOrganisation = null
  user.removedFromOrganisationAt = null
  if (user.signupMethod === 'invite') user.active = true
  await user.save()

  if (org.packages?.length && accountStatus(user) === 'active') await grantSponsoredPackages(user)
  return { user, organisation: org }
}

// ---- Stats -------------------------------------------------------------------

/** Headline numbers for the organisation dashboard (and the admin drill-down). */
export async function organisationStats(orgId) {
  const members = await User.find({ organisation: orgId, organisationRole: 'member' }).select('_id')
  const students = members.length

  // The sponsored course at a glance: how many seats have landed, and how the
  // class is pacing. Null when the organisation sponsors nothing.
  const org = await Organisation.findById(orgId).select('packages seats')
  // Paid-for seats and how many are taken; null for an institution with no limit.
  const seats = await seatSummary(org)
  const [course] = await sponsoredCourses(org)
  if (!course) return { students, seats, course: null }
  const ids = members.map((m) => m._id)
  const enrolled = await Enrollment.countDocuments({ user: { $in: ids }, sponsoredBy: orgId })
  const rows = [...(await rosterCourseProgress(org, ids)).values()]
  const count = (pace) => rows.filter((r) => r.pace === pace).length
  const started = rows.filter((r) => r.pace !== 'not-started')
  return {
    students,
    seats,
    course: {
      name: course.name,
      enrolled,
      pending: Math.max(0, students - enrolled),
      started: started.length,
      done: count('done'),
      onTrack: count('on-track') + count('ahead'),
      behind: count('behind'),
      avgPercent: started.length
        ? Math.round(started.reduce((a, r) => a + r.percent, 0) / started.length)
        : 0,
    },
  }
}
