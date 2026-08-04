import multer from 'multer'
import crypto from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { TMP_DIR, saveVideo } from '../../../config/uploads.js'
import { transcodeToHls } from '../../../config/transcoder.js'

// Multer only STAGES the upload to a temp dir; the storage adapter (saveVideo)
// decides the final destination (local disk now, S3 later) — so the endpoint
// stays identical across storage backends.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex')),
})

const single = multer({
  storage,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true)
    else cb(Object.assign(new Error('Only video files are allowed'), { status: 400 }), false)
  },
}).single('video')

// Wrap multer so its errors (size limit, wrong type) become clean 400s.
export function uploadVideoMw(req, res, next) {
  single(req, res, (err) => {
    if (err) {
      err.status = err.status || 400
      if (err.code === 'LIMIT_FILE_SIZE') err.message = 'Video is too large (max 300 MB)'
      return next(err)
    }
    next()
  })
}

/**
 * Live transcode progress, keyed by an `uploadId` the client generates. The
 * upload request stays open while ffmpeg runs, so the client polls this to show
 * a real percentage instead of an indefinite spinner.
 */
const jobs = new Map() // uploadId → { pct, startedAt }

// GET /api/admin/upload/progress/:id
export const uploadProgress = asyncHandler(async (req, res) => {
  const job = jobs.get(req.params.id)
  if (!job) return res.json({ pct: 0, found: false })
  res.json({ ...job, found: true, elapsedMs: Date.now() - job.startedAt })
})

// POST /api/admin/upload/video  (multipart field "video")
// Transcodes the upload into an adaptive HLS ladder (smooth on slow networks);
// falls back to storing the raw MP4 if transcoding is unavailable, so uploads
// never hard-fail. Returns `type` ('hls' | 'mp4') and (for HLS) the probed
// duration so the form can auto-fill it.
export const uploadVideo = asyncHandler(async (req, res) => {
  if (!req.file) {
    const err = new Error('No video file received')
    err.status = 400
    throw err
  }

  const id = crypto.randomBytes(12).toString('hex')
  const uploadId = String(req.query.uploadId || '')
  if (uploadId) jobs.set(uploadId, { pct: 0, startedAt: Date.now() })
  const done = () => { if (uploadId) setTimeout(() => jobs.delete(uploadId), 30_000) }

  try {
    const { masterUrl, key, durationMins } = await transcodeToHls(req.file.path, id, {
      onProgress: (pct) => { if (uploadId) jobs.set(uploadId, { ...jobs.get(uploadId), pct }) },
    })
    await unlink(req.file.path).catch(() => {}) // drop the raw upload; HLS is stored
    done()
    return res.status(201).json({ url: masterUrl, key, type: 'hls', durationMins, size: req.file.size })
  } catch (err) {
    done()
    // Transcoding failed (e.g. AWS branch not wired, or a codec ffmpeg can't
    // read) — keep the original file playable rather than losing the upload.
    const { url, key } = await saveVideo(req.file.path, req.file.originalname)
    return res.status(201).json({ url, key, type: 'mp4', size: req.file.size, warning: err.message })
  }
})
