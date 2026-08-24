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

// The largest course video the admin panel will accept. Written once so the
// cap and the message the uploader reads can never drift apart.
const MAX_VIDEO_MB = 2048 // 2 GB

const single = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024 },
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
      if (err.code === 'LIMIT_FILE_SIZE') {
        err.message = `Video is too large (max ${MAX_VIDEO_MB >= 1024 ? `${MAX_VIDEO_MB / 1024} GB` : `${MAX_VIDEO_MB} MB`})`
      }
      return next(err)
    }
    next()
  })
}

/**
 * Transcode jobs, keyed by an `uploadId`.
 *
 * The upload request used to stay open while ffmpeg ran, which meant the whole
 * transcode had to finish inside one HTTP request. Behind CloudFront that is a
 * hard 60-second ceiling — AWS's own maximum without a quota increase — so a
 * large video was guaranteed to time out even though the server would have
 * finished the work a few minutes later.
 *
 * The request now returns as soon as the bytes have landed, and ffmpeg runs on
 * after it. This map is how the client follows along: it holds the live
 * percentage while the job runs and the finished result afterwards, so the
 * poller that already existed for the percentage also delivers the video URL.
 *
 * In memory on purpose: one task, and a job is meaningless once the process
 * that owns the temp file has gone. A restart mid-transcode loses the job, and
 * the admin uploads again — the same thing that happened before, just visible.
 *
 * uploadId → { status: 'processing'|'ready'|'failed', pct, startedAt, ...result }
 */
const jobs = new Map()

// A finished job is kept around long enough for a client that was mid-poll — or
// briefly offline — to still collect its result.
const KEEP_FINISHED_MS = 10 * 60_000

function finish(uploadId, payload) {
  if (!uploadId) return
  jobs.set(uploadId, { ...jobs.get(uploadId), ...payload, finishedAt: Date.now() })
  setTimeout(() => jobs.delete(uploadId), KEEP_FINISHED_MS).unref?.()
}

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
/**
 * Build the adaptive ladder and record the outcome on the job. Runs AFTER the
 * upload request has already been answered, so nothing here may throw into a
 * response — every path ends by writing a result the client can poll for.
 */
async function processUpload(uploadId, file) {
  const id = crypto.randomBytes(12).toString('hex')
  try {
    const { masterUrl, key, durationMins } = await transcodeToHls(file.path, id, {
      onProgress: (pct) => {
        const job = jobs.get(uploadId)
        if (job && job.status === 'processing') jobs.set(uploadId, { ...job, pct })
      },
    })
    await unlink(file.path).catch(() => {}) // drop the raw upload; HLS is stored
    finish(uploadId, { status: 'ready', pct: 100, url: masterUrl, key, type: 'hls', durationMins, size: file.size })
  } catch (err) {
    // Transcoding failed (e.g. the AWS branch is not wired, or a codec ffmpeg
    // cannot read) — keep the original file playable rather than losing the
    // upload, exactly as the synchronous version did.
    try {
      const { url, key } = await saveVideo(file.path, file.originalname)
      finish(uploadId, { status: 'ready', pct: 100, url, key, type: 'mp4', size: file.size, warning: err.message })
    } catch (saveErr) {
      await unlink(file.path).catch(() => {})
      finish(uploadId, { status: 'failed', error: saveErr.message || err.message })
    }
  }
}

export const uploadVideo = asyncHandler(async (req, res) => {
  if (!req.file) {
    const err = new Error('No video file received')
    err.status = 400
    throw err
  }

  // The client may supply its own id so it can start polling before this
  // returns; when it does not, one is minted and handed back.
  const uploadId = String(req.query.uploadId || '') || crypto.randomBytes(9).toString('hex')
  jobs.set(uploadId, { status: 'processing', pct: 0, startedAt: Date.now() })

  // Answer now — the bytes are safely on disk. Transcoding carries on behind
  // this response, which is what keeps a long video from dying on CloudFront's
  // 60-second origin timeout.
  res.status(202).json({ uploadId, status: 'processing', size: req.file.size })

  processUpload(uploadId, req.file)
})
