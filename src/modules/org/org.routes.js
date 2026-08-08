import { Router } from 'express'
import multer from 'multer'
import { asyncHandler } from '../../utils/asyncHandler.js'
import { requireOrgModule } from '../../middleware/auth.js'
import * as orgService from '../user/organisation/organisation.service.js'
import * as scholarship from '../user/scholarship/scholarship.service.js'
import { ORG_MODULES, ORG_TYPE_LABELS } from '../user/organisation/organisation.model.js'

// Mounted at /api/org — every route below already passed requireOrgAuth, so
// `req.org` is a real, approved, active organisation and IS the scope of every
// query. Nothing here ever takes an organisation id from the client.
const router = Router()

// CSV rosters are small text files; keep them in memory and parse in the
// service — nothing is written to disk.
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB ≈ 20k roster rows
  fileFilter: (req, file, cb) => {
    // Browsers label .csv inconsistently (text/csv, application/vnd.ms-excel,
    // sometimes octet-stream), so trust the extension too.
    const ok = /csv|excel|spreadsheet|octet-stream|text\/plain/i.test(file.mimetype) || /\.csv$/i.test(file.originalname)
    cb(ok ? null : Object.assign(new Error('Please upload a .csv file'), { status: 400 }), ok)
  },
}).single('file')

function csvUploadMw(req, res, next) {
  csvUpload(req, res, (err) => {
    if (err) {
      err.status = err.status || 400
      if (err.code === 'LIMIT_FILE_SIZE') err.message = 'That CSV is too large (max 2 MB)'
      return next(err)
    }
    next()
  })
}

// ---- Identity & profile ------------------------------------------------------

// GET /api/org/me — who am I, what can I reach, and where is my scholarship at
router.get('/me', asyncHandler(async (req, res) => {
  const [stats, current] = await Promise.all([
    orgService.organisationStats(req.org.id),
    scholarship.currentCycleFor(req.org.id),
  ])
  res.json({
    organisation: orgService.fullOrgDTO(req.org.doc),
    typeLabel: ORG_TYPE_LABELS[req.org.doc.type] || req.org.doc.type,
    user: req.orgUser,
    modules: req.org.modules,
    allModules: ORG_MODULES,
    stats,
    currentCycle: current ? scholarship.cycleDTO(current) : null,
  })
}))

// PATCH /api/org/profile — the organisation editing its own public details
router.patch('/profile', requireOrgModule('profile'), asyncHandler(async (req, res) => {
  const org = await orgService.updateOwnProfile(req.org.id, req.body || {})
  res.json({ organisation: orgService.fullOrgDTO(org) })
}))

// ---- Students ----------------------------------------------------------------

const students = Router()
students.use(requireOrgModule('students'))

// GET /api/org/students/sample.csv — the import template (declared before the
// generic list route so "sample.csv" is never read as a student id)
students.get('/sample.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="svastrino-students-sample.csv"')
  res.send(orgService.sampleCsv())
})

// GET /api/org/students?q=&cycleId=
students.get('/', asyncHandler(async (req, res) => {
  res.json({
    students: await orgService.listOrgStudents(req.org.id, { q: req.query.q, cycleId: req.query.cycleId }),
  })
}))

// POST /api/org/students — add one student (and enrol them in the live cycle)
students.post('/', asyncHandler(async (req, res) => {
  const cycle = await scholarship.currentCycleFor(req.org.id)
  const result = await orgService.addOrgStudent(req.org.id, req.body || {}, cycle)
  res.status(201).json({
    ok: true,
    status: result.status,
    message: result.message,
    enrolled: !!result.enrolled,
    invited: !!result.link,
  })
}))

// POST /api/org/students/bulk — CSV import. `dryRun=1` previews without writing.
students.post('/bulk', csvUploadMw, asyncHandler(async (req, res) => {
  const csvText = req.file ? req.file.buffer.toString('utf8') : String(req.body?.csv || '')
  if (!csvText.trim()) {
    const err = new Error('No CSV received — attach a .csv file')
    err.status = 400
    throw err
  }
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true'
  const cycle = await scholarship.currentCycleFor(req.org.id)
  res.json(await orgService.bulkImportStudents(req.org.id, csvText, { dryRun, cycle }))
}))

// DELETE /api/org/students/:id — detach from the organisation (account survives)
students.delete('/:id', asyncHandler(async (req, res) => {
  await orgService.removeOrgStudent(req.org.id, req.params.id)
  res.json({ ok: true })
}))

router.use('/students', students)

export default router
