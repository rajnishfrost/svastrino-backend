import { asyncHandler } from '../../../utils/asyncHandler.js'
import { rupees } from '../../../utils/money.js'
import * as service from './manage.service.js'

const userDTO = (u) => ({
  id: u._id, name: u.name, email: u.email, phone: u.phone || null,
  role: u.role || 'student', emailVerified: u.emailVerified, createdAt: u.createdAt,
  active: u.active !== false,
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
  features: p.features, cta: p.cta, variant: p.variant, featured: p.featured, badge: p.badge,
  order: p.order, active: p.active,
})
const sessionDTO = (s) => ({
  id: s._id, order: s.order, tier: s.tier, title: s.title, description: s.description,
  videoUrl: s.videoUrl, durationMins: s.durationMins, worksheet: s.worksheet, active: s.active,
  captions: (s.captions || []).map((c) => ({ lang: c.lang, label: c.label, url: c.url })),
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
  const users = await service.listUsers({ q: req.query.q })
  res.json({ users: users.map(userDTO) })
})
export const patchUserRole = asyncHandler(async (req, res) => {
  const user = await service.setUserRole(req.admin, req.params.id, String(req.body.role || ''))
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
