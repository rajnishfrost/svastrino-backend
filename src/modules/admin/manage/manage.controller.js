import { asyncHandler } from '../../../utils/asyncHandler.js'
import { mediaUrl } from '../../../config/uploads.js'
import { rupees } from '../../../utils/money.js'
import * as service from './manage.service.js'
import { accountStatus } from '../../user/credentials/accountStatus.js'

const userDTO = (u) => ({
  id: u._id, name: u.name, email: u.email, phone: u.phone || null,
  role: u.role || 'student', emailVerified: u.emailVerified, createdAt: u.createdAt,
  active: u.active !== false,
  // Whether the student portal is open to this account. Meaningless for a
  // student (it always is), so the Users page only offers it on other roles.
  siteAccess: u.siteAccess !== false,
  // 'active' | 'invited' | 'disabled' — the same rule the organisation's own
  // roster shows, so one person cannot read two ways on two screens.
  status: accountStatus(u),
  // Who this account belongs to. A public signup belongs to nobody, and that
  // is an answer ("Self"), not a gap — the client says so rather than "—".
  organisation: u.organisation ? { id: u.organisation._id, name: u.organisation.name } : null,
  // Set only after an organisation removed them — what the Restore button undoes.
  removedFrom: u.removedFromOrganisation
    ? { id: u.removedFromOrganisation._id, name: u.removedFromOrganisation.name, at: u.removedFromOrganisationAt || null }
    : null,
  // How it was made, and by whom. `createdBy: null` means they made it
  // themselves, which is the ordinary case and reads as "Self".
  signupMethod: u.signupMethod || 'password',
  createdBy: u.createdBy ? { id: u.createdBy._id, name: u.createdBy.name, email: u.createdBy.email } : null,
  lastLoginAt: u.lastLoginAt || null,
})
const pkgDTO = (p) => ({
  id: p._id, sku: p.sku, slug: p.slug,
  skillBuild: p.skillBuild
    ? { name: p.skillBuild.name, slug: p.skillBuild.slug, kind: p.skillBuild.kind || 'course' }
    : null,
  name: p.name, tagline: p.tagline,
  price: p.price, priceInr: rupees(p.price),
  earlyBird: p.earlyBird, earlyBirdInr: p.earlyBird != null ? rupees(p.earlyBird) : null,
  period: p.period, durationDays: p.durationDays,
  sessionsCount: p.sessionsCount, sessionMins: p.sessionMins,
  features: p.features, benefits: p.benefits || [],
  modeLabel: p.modeLabel || '', priceNote: p.priceNote || '',
  summary: p.summary || '', trustLine: p.trustLine || '',
  durationLabel: p.durationLabel || '', sessionsLabel: p.sessionsLabel || '',
  deliveryMode: p.deliveryMode || '', buyMode: p.buyMode || 'self-serve',
  paymentMode: p.paymentMode || 'one-time', phases: p.phases || 1,
  includesPsychometric: !!p.includesPsychometric,
  cta: p.cta, variant: p.variant, featured: p.featured, badge: p.badge,
  order: p.order, active: p.active, listed: p.listed !== false,
})
const sessionDTO = (s) => ({
  id: s._id, order: s.order, tier: s.tier, title: s.title, description: s.description,
  videoUrl: mediaUrl(s.videoUrl), durationMins: s.durationMins, worksheet: s.worksheet, active: s.active,
  captions: (s.captions || []).map((c) => ({ lang: c.lang, label: c.label, url: mediaUrl(c.url) })),
})

// Dashboard
export const getStats = asyncHandler(async (req, res) => {
  const s = await service.stats()
  res.json({
    ...s,
    revenueInr: rupees(s.revenue),
    refundedInr: rupees(s.refunded),
    netRevenueInr: rupees(s.netRevenue),
    avgOrderInr: rupees(s.avgOrder),
  })
})

// Users
export const getUsers = asyncHandler(async (req, res) => {
  const [list, signups] = await Promise.all([
    service.listUsers({ q: req.query.q, page: req.query.page, limit: req.query.limit }),
    service.signupBreakdown(),
  ])
  // The rows are this page's, the counts are everyone's — see signupBreakdown.
  res.json({ ...list, users: list.items.map(userDTO), signups })
})
export const patchUserRole = asyncHandler(async (req, res) => {
  const user = await service.setUserRole(req.admin, req.params.id, String(req.body.role || ''))
  res.json({ user: userDTO(user) })
})

// PATCH /api/admin/users/:id/site-access  { siteAccess }
// Whether this non-student account may use the student portal at all.
export const patchUserSiteAccess = asyncHandler(async (req, res) => {
  const user = await service.setUserSiteAccess(req.admin, req.params.id, !!req.body.siteAccess)
  res.json({ user: userDTO(user) })
})

// Packages (pricing)
export const getPackages = asyncHandler(async (req, res) => {
  const list = await service.listPackages()
  res.json({ packages: list.map(pkgDTO) })
})
export const patchPackage = asyncHandler(async (req, res) => {
  const pkg = await service.updatePackage(req.params.id, req.body)
  res.json({ package: pkgDTO(pkg) })
})
export const postPackage = asyncHandler(async (req, res) => {
  const pkg = await service.createPackage(req.body || {})
  res.status(201).json({ package: pkgDTO(pkg) })
})

// Content — skill-builds + sessions
const sbDTO = (s) => ({
  slug: s.slug, name: s.name, kind: s.kind || 'course',
  tagline: s.tagline || '', order: s.order || 0, active: s.active !== false,
})
export const getSkillBuilds = asyncHandler(async (req, res) => {
  // ?all=1 → every product incl. mentoring (Skill Builds admin + package picker);
  // default stays course-only (the content manager has no mentoring sessions).
  const list = req.query.all === '1' ? await service.listAllSkillBuilds() : await service.listSkillBuilds()
  res.json({ skillBuilds: list.map(sbDTO) })
})
export const postSkillBuild = asyncHandler(async (req, res) => {
  const sb = await service.createSkillBuild(req.body || {})
  res.status(201).json({ skillBuild: sbDTO(sb) })
})
export const patchSkillBuild = asyncHandler(async (req, res) => {
  const sb = await service.updateSkillBuild(req.params.slug, req.body || {})
  res.json({ skillBuild: sbDTO(sb) })
})
export const getSessions = asyncHandler(async (req, res) => {
  const { skillBuild, sessions } = await service.listSessions(req.params.slug)
  res.json({ skillBuild: { slug: skillBuild.slug, name: skillBuild.name }, sessions: sessions.map(sessionDTO) })
})
export const postSession = asyncHandler(async (req, res) => {
  const s = await service.createSession(req.params.slug, req.body)
  res.status(201).json({ session: sessionDTO(s) })
})
export const patchSession = asyncHandler(async (req, res) => {
  const s = await service.updateSession(req.params.id, req.body)
  res.json({ session: sessionDTO(s) })
})
export const deleteSessionH = asyncHandler(async (req, res) => {
  res.json(await service.deleteSession(req.params.id))
})

export const getQuestions = asyncHandler(async (req, res) => {
  res.json(await service.listQuestions(req.params.id))
})
export const putQuestions = asyncHandler(async (req, res) => {
  res.json(await service.saveQuestions(req.params.id, req.body?.prompts))
})

export const getSessionAnswers = asyncHandler(async (req, res) => {
  res.json(await service.listSessionAnswers(req.params.id))
})
