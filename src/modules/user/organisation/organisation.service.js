import crypto from 'node:crypto'
import { Organisation, ORG_TYPES, ORG_MODULES, DEFAULT_ORG_MODULES } from './organisation.model.js'
import { User } from '../credentials/credentials.model.js'
import { provisionAccount } from '../credentials/credentials.service.js'
import { ScholarshipCycle, ScholarshipEnrollment, ScholarshipAttempt } from '../scholarship/scholarship.model.js'
import { parseCsvRecords, buildCsv } from '../../../utils/csv.js'
import {
  sendScholarshipStatusEmail,
  sendOrgApprovedEmail,
  sendStudentInviteEmail,
} from '../../../utils/mailer.js'

const httpError = (message, status, code) => {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

const str = (v, max = 200) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max)
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
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
  publicListed: !!o.publicListed,
  active: o.active !== false,
  reviewedAt: o.reviewedAt || null,
  createdAt: o.createdAt,
})

// ---- Partner application (public form) --------------------------------------

/** Public form submission. One application per client IP, as before. */
export async function submitApplication(body, ip) {
  const name = str(body.name, 120)
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

  return Organisation.create({
    name,
    type,
    description: str(body.description, 1200),
    branch: str(body.branch, 120),
    address: str(body.address, 240),
    city: str(body.city, 80),
    state: str(body.state, 80),
    pincode: str(body.pincode, 12),
    website: str(body.website, 200),
    contactPerson: str(body.contactPerson, 80),
    phone: str(body.phone, 20),
    email,
    submittedIp: ip || '',
    status: 'pending',
  })
}

// ---- Admin: listing & review -------------------------------------------------

export async function listOrganisations({ status, type, q } = {}) {
  const filter = {}
  if (status && ['pending', 'approved', 'rejected'].includes(status)) filter.status = status
  if (type && ORG_TYPES.includes(type)) filter.type = type
  if (q) {
    const rx = new RegExp(escapeRegExp(q), 'i')
    filter.$or = [{ name: rx }, { email: rx }, { city: rx }, { state: rx }, { code: rx }]
  }
  return Organisation.find(filter)
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1, branch: 1 })
    .limit(500)
}

export async function getOrganisation(id) {
  const org = await Organisation.findById(id)
  if (!org) throw httpError('Organisation not found', 404)
  return org
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
    // Fire-and-forget — a mail failure must never fail the review.
    sendScholarshipStatusEmail(org.email, {
      name: org.contactPerson || org.name,
      institution: org.name,
      status,
      reason: org.rejectionReason,
    }).catch((e) => console.error('✗ organisation status email failed:', e.message))
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
  if (body.publicListed !== undefined) org.publicListed = !!body.publicListed
  if (body.active !== undefined) org.active = !!body.active

  await org.save()
  return org
}

/** Profile fields an organisation may edit about itself (shared with admin). */
function applyProfileFields(org, body) {
  if (body.name !== undefined) {
    const name = str(body.name, 120)
    if (!name) throw httpError('Organisation name is required', 400)
    org.name = name
  }
  if (body.description !== undefined) org.description = str(body.description, 1200)
  if (body.branch !== undefined) org.branch = str(body.branch, 120)
  if (body.address !== undefined) org.address = str(body.address, 240)
  if (body.city !== undefined) org.city = str(body.city, 80)
  if (body.state !== undefined) org.state = str(body.state, 80)
  if (body.pincode !== undefined) org.pincode = str(body.pincode, 12)
  if (body.website !== undefined) org.website = str(body.website, 200)
  if (body.contactPerson !== undefined) org.contactPerson = str(body.contactPerson, 80)
  if (body.phone !== undefined) org.phone = str(body.phone, 20)
}

/** The organisation editing its own profile — never its status/modules/email. */
export async function updateOwnProfile(orgId, body = {}) {
  const org = await Organisation.findById(orgId)
  if (!org) throw httpError('Organisation not found', 404)
  applyProfileFields(org, body)
  // Opting out of the public directory is the organisation's own call.
  if (body.publicListed !== undefined) org.publicListed = !!body.publicListed
  await org.save()
  return org
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

/** Approved + active organisations — the student enrolment dropdown. */
export async function enrollableOrganisations() {
  return Organisation.find({ status: 'approved', active: true })
    .collation({ locale: 'en', strength: 2 })
    .sort({ name: 1, branch: 1 })
    .select('name type branch city state code')
}

// ---- Students ----------------------------------------------------------------

// The columns an organisation fills in. `email` is the identity; the rest is
// roster detail carried onto the scholarship enrolment.
const CSV_COLUMNS = ['name', 'email', 'phone', 'class', 'section', 'rollno']
const CSV_HEADERS = ['name', 'email', 'phone', 'class', 'section', 'rollNo']

/** The downloadable template, with two filled example rows to copy. */
export function sampleCsv() {
  return buildCsv(CSV_HEADERS, [
    ['Aarav Sharma', 'aarav.sharma@example.com', '9876543210', '10', 'A', '23'],
    ['Diya Verma', 'diya.verma@example.com', '9812345678', '12', 'B', '07'],
  ])
}

/**
 * Every account attached to this organisation, with its scholarship status for
 * the given cycle (or the organisation's latest cycle when none is passed).
 */
export async function listOrgStudents(orgId, { q, cycleId } = {}) {
  const filter = { organisation: orgId, organisationRole: 'member' }
  if (q) {
    const rx = new RegExp(escapeRegExp(q), 'i')
    filter.$or = [{ name: rx }, { email: rx }]
  }
  const users = await User.find(filter).sort({ createdAt: -1 }).limit(2000).select('+passwordHash')
  const ids = users.map((u) => u._id)

  const enrolFilter = { organisation: orgId, user: { $in: ids } }
  if (cycleId) enrolFilter.cycle = cycleId
  const enrollments = await ScholarshipEnrollment.find(enrolFilter).sort({ createdAt: -1 })
  const attempts = await ScholarshipAttempt.find({
    user: { $in: ids },
    ...(cycleId ? { cycle: cycleId } : { organisation: orgId }),
  })

  // Latest enrolment/attempt wins when no cycle was specified.
  const enrolByUser = new Map()
  for (const e of enrollments) if (!enrolByUser.has(String(e.user))) enrolByUser.set(String(e.user), e)
  const attemptByUser = new Map()
  for (const a of attempts) if (!attemptByUser.has(String(a.user))) attemptByUser.set(String(a.user), a)

  return users.map((u) => {
    const e = enrolByUser.get(String(u._id))
    const a = attemptByUser.get(String(u._id))
    return {
      id: u._id,
      name: u.name || '—',
      email: u.email,
      phone: u.phone || '',
      studentClass: e?.studentClass || '',
      section: e?.section || '',
      rollNo: e?.rollNo || '',
      enrolled: !!e,
      source: e?.source || null,
      // Has the student claimed the account we created for them?
      activated: !!u.passwordHash,
      attempt: a ? a.status : 'not_started',
      score: a?.status === 'submitted' ? a.score : null,
      total: a?.total ?? null,
      addedAt: u.createdAt,
    }
  })
}

/**
 * Add one student: provision the account, attach it to the organisation, and
 * (when a cycle is open) enrol them into it. Shared by the single-add form and
 * the CSV importer so both behave identically.
 */
async function addStudent(org, row, cycle) {
  const email = String(row.email || '').trim().toLowerCase()
  if (!isEmail(email)) throw httpError('Enter a valid email', 400)

  const { user, created, link, attached } = await provisionAccount({
    email,
    name: str(row.name, 80),
    phone: str(row.phone, 20) || undefined,
    organisation: org._id,
    organisationRole: 'member',
  })

  // Belongs to someone else already — never steal them, just report it.
  if (String(user.organisation || '') !== String(org._id)) {
    return { user, status: 'conflict', message: 'Already belongs to another organisation' }
  }

  let enrolled = false
  if (cycle) {
    const existing = await ScholarshipEnrollment.findOne({ user: user._id, cycle: cycle._id })
    if (existing) {
      // Refresh roster detail from the newer import.
      if (row.class) existing.studentClass = str(row.class, 20)
      if (row.section) existing.section = str(row.section, 20)
      if (row.rollno ?? row.rollNo) existing.rollNo = str(row.rollno ?? row.rollNo, 30)
      await existing.save()
    } else {
      await ScholarshipEnrollment.create({
        user: user._id,
        cycle: cycle._id,
        organisation: org._id,
        studentClass: str(row.class, 20),
        section: str(row.section, 20),
        rollNo: str(row.rollno ?? row.rollNo, 30),
        source: row.__source || 'org',
      })
      enrolled = true
    }
  }

  return {
    user,
    link,
    status: created ? 'created' : attached ? 'linked' : 'existing',
    enrolled,
    message: created
      ? 'Account created'
      : attached
        ? 'Existing account linked to your organisation'
        : enrolled
          ? 'Already a member — enrolled in this cycle'
          : 'Already a member',
  }
}

/** Single manual add from the portal. Sends the invite when it's a new account. */
export async function addOrgStudent(orgId, body, cycle) {
  const org = await Organisation.findById(orgId)
  if (!org) throw httpError('Organisation not found', 404)
  const res = await addStudent(org, { ...body, __source: 'org' }, cycle)
  if (res.status === 'conflict') throw httpError(res.message, 409, 'OTHER_ORGANISATION')
  if (res.link) {
    sendStudentInviteEmail(res.user.email, {
      name: res.user.name,
      organisation: org.name,
      link: res.link,
      cycleTitle: cycle?.title || '',
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
export async function bulkImportStudents(orgId, csvText, { dryRun = false, cycle = null } = {}) {
  const org = await Organisation.findById(orgId)
  if (!org) throw httpError('Organisation not found', 404)

  const { records, rawHeaders = [] } = parseCsvRecords(csvText)
  if (!records.length) throw httpError('That CSV has no data rows. Download the sample and fill it in.', 400)
  if (records.length > MAX_IMPORT_ROWS) {
    throw httpError(`That's ${records.length} rows — please split the file into batches of ${MAX_IMPORT_ROWS}.`, 400)
  }
  if (!records[0] || !('email' in records[0])) {
    throw httpError(
      `Missing an "email" column. Expected: ${CSV_HEADERS.join(', ')} — found: ${rawHeaders.join(', ') || 'nothing'}`,
      400
    )
  }

  const results = []
  const invites = []
  const seen = new Set() // duplicate emails inside the same file

  for (const rec of records) {
    const email = String(rec.email || '').trim().toLowerCase()
    const base = { line: rec.__line, name: rec.name || '', email }

    if (!isEmail(email)) { results.push({ ...base, status: 'error', message: 'Invalid or missing email' }); continue }
    if (seen.has(email)) { results.push({ ...base, status: 'skipped', message: 'Duplicate row in this file' }); continue }
    seen.add(email)

    if (dryRun) {
      const existing = await User.findOne({ email }).select('organisation organisationRole')
      const otherOrg = existing?.organisation && String(existing.organisation) !== String(org._id)
      results.push({
        ...base,
        status: otherOrg ? 'conflict' : existing ? 'existing' : 'created',
        message: otherOrg
          ? 'Already belongs to another organisation — will be skipped'
          : existing
            ? 'Account exists — will be linked and enrolled'
            : 'New account will be created and invited',
      })
      continue
    }

    try {
      const r = await addStudent(org, { ...rec, __source: 'bulk' }, cycle)
      results.push({ ...base, status: r.status, message: r.message, enrolled: r.enrolled })
      if (r.link) invites.push({ email: r.user.email, name: r.user.name, link: r.link })
    } catch (e) {
      results.push({ ...base, status: 'error', message: e.message })
    }
  }

  // Gentle on SMTP: one at a time, and a failure only affects that student.
  if (!dryRun && invites.length) {
    ;(async () => {
      for (const inv of invites) {
        try {
          await sendStudentInviteEmail(inv.email, {
            name: inv.name,
            organisation: org.name,
            link: inv.link,
            cycleTitle: cycle?.title || '',
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
    cycle: cycle ? { id: cycle._id, year: cycle.year, title: cycle.title } : null,
    results,
  }
}

/**
 * Detach a student from the organisation. Their account and history survive —
 * we only clear the organisation link and their enrolments/attempts in THIS
 * organisation's cycles, so the roster and leaderboards stay consistent.
 */
export async function removeOrgStudent(orgId, userId) {
  const user = await User.findOne({ _id: userId, organisation: orgId, organisationRole: 'member' })
  if (!user) throw httpError('Student not found in your organisation', 404)

  await ScholarshipAttempt.deleteMany({ user: user._id, organisation: orgId })
  await ScholarshipEnrollment.deleteMany({ user: user._id, organisation: orgId })

  user.organisation = null
  user.organisationRole = null
  await user.save()
}

// ---- Stats -------------------------------------------------------------------

/** Headline numbers for the organisation dashboard (and the admin drill-down). */
export async function organisationStats(orgId) {
  const [students, cycles, enrolments, submitted, latest] = await Promise.all([
    User.countDocuments({ organisation: orgId, organisationRole: 'member' }),
    ScholarshipCycle.countDocuments({ organisation: orgId }),
    ScholarshipEnrollment.countDocuments({ organisation: orgId }),
    ScholarshipAttempt.countDocuments({ organisation: orgId, status: 'submitted' }),
    ScholarshipCycle.findOne({ organisation: orgId }).sort({ year: -1 }),
  ])
  return {
    students,
    cycles,
    enrolments,
    submitted,
    latestCycle: latest ? { id: latest._id, year: latest.year, title: latest.title, status: latest.status } : null,
  }
}
