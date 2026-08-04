import multer from 'multer'
import crypto from 'node:crypto'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { TMP_DIR, saveReport } from '../../../config/uploads.js'

// Admin re-hosts the Mindler career-report PDF (it's behind the partner login,
// so we can't hotlink it). PDF only.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex')),
})

const single = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB — a 34-page report is well under this
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true)
    else cb(Object.assign(new Error('Only PDF files are allowed'), { status: 400 }), false)
  },
}).single('report')

// Wrap multer so its errors become clean 400s.
export function uploadReportMw(req, res, next) {
  single(req, res, (err) => {
    if (err) {
      err.status = err.status || 400
      if (err.code === 'LIMIT_FILE_SIZE') err.message = 'PDF is too large (max 20 MB)'
      return next(err)
    }
    next()
  })
}

// POST /api/admin/assessments/report-pdf  (multipart field "report", requireAdminAuth)
export const uploadReport = asyncHandler(async (req, res) => {
  if (!req.file) {
    const err = new Error('No PDF received')
    err.status = 400
    throw err
  }
  const { url } = await saveReport(req.file.path, '.pdf')
  res.status(201).json({ url })
})
