import crypto from 'node:crypto'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { STORAGE } from '../../../config/uploads.js'
import {
  contentTypeFor, startMultipart, presignPart, completeMultipart, abortMultipart,
} from '../../../config/s3.js'
import { startTranscodeFromS3, MAX_VIDEO_MB } from './upload.controller.js'

/**
 * Browser-direct video upload.
 *
 * The admin's browser sends the file straight to S3 with signed URLs. Nothing
 * about a course video passes through this server: CloudFront allows an origin
 * 60 seconds to respond and cannot be raised past it, and a multi-gigabyte body
 * would otherwise sit on the same task that serves the site.
 *
 * The flow is init → (part-url · PUT) × N → complete. The server only mints
 * URLs and stitches the result; the bytes never touch it.
 */

// 8 MB parts. S3's floor is 5 MB for every part but the last; 8 keeps the part
// count sane for a 2 GB file (256 parts) without making a single failed part
// expensive to retry on a slow line.
const PART_SIZE = 8 * 1024 * 1024

const fail = (message, status = 400) => {
  const err = new Error(message)
  err.status = status
  return err
}

/**
 * GET /api/admin/upload/mode
 * Tells the client which of the two upload paths to use. Direct-to-S3 needs S3
 * configured; on a local dev box the file still goes through the server, and
 * the client must be able to tell without guessing from the environment.
 */
export const uploadMode = asyncHandler(async (req, res) => {
  res.json({
    mode: STORAGE === 's3' ? 's3' : 'server',
    partSize: PART_SIZE,
    maxBytes: MAX_VIDEO_MB * 1024 * 1024,
  })
})

// POST /api/admin/upload/s3/init  { filename, size }
export const initUpload = asyncHandler(async (req, res) => {
  if (STORAGE !== 's3') throw fail('Direct upload is only available when media is stored on S3')

  const filename = String(req.body?.filename || '').trim()
  const size = Number(req.body?.size || 0)
  if (!filename) throw fail('filename is required')
  if (!Number.isFinite(size) || size <= 0) throw fail('size is required')
  if (size > MAX_VIDEO_MB * 1024 * 1024) {
    throw fail(`Video is too large (max ${MAX_VIDEO_MB / 1024} GB)`)
  }

  const type = contentTypeFor(filename)
  if (!type.startsWith('video/')) throw fail('Only video files are allowed')

  // A fresh random name, as the through-the-server path also does: the admin's
  // own filename is never part of a public URL.
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '.mp4'
  const key = `videos/${crypto.randomBytes(12).toString('hex')}${ext}`

  const { uploadId } = await startMultipart(key, type)
  res.status(201).json({ key, uploadId, partSize: PART_SIZE, parts: Math.ceil(size / PART_SIZE) })
})

// POST /api/admin/upload/s3/part-url  { key, uploadId, partNumber }
// Minted one at a time rather than all at once: a 2 GB file is 256 parts, and
// signing them upfront hands out 256 write URLs for an upload that may be
// abandoned after the first.
export const partUrl = asyncHandler(async (req, res) => {
  if (STORAGE !== 's3') throw fail('Direct upload is only available when media is stored on S3')
  const { key, uploadId } = req.body || {}
  const partNumber = Number(req.body?.partNumber)
  if (!key || !uploadId) throw fail('key and uploadId are required')
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw fail('partNumber must be between 1 and 10000')
  }
  res.json({ url: await presignPart(String(key), String(uploadId), partNumber) })
})

// POST /api/admin/upload/s3/complete  { key, uploadId, parts:[{PartNumber,ETag}] }
export const completeUpload = asyncHandler(async (req, res) => {
  if (STORAGE !== 's3') throw fail('Direct upload is only available when media is stored on S3')
  const { key, uploadId, parts } = req.body || {}
  if (!key || !uploadId) throw fail('key and uploadId are required')
  if (!Array.isArray(parts) || !parts.length) throw fail('parts are required')

  const { url } = await completeMultipart(String(key), String(uploadId), parts)

  // The file is in the bucket; building the adaptive ladder is a separate,
  // longer job. Hand back a job id the client can poll, exactly as the
  // through-the-server path does, so the admin panel has one thing to follow.
  const jobId = startTranscodeFromS3({ key: String(key), url })
  res.status(202).json({ jobId, key, url, status: 'processing' })
})

// POST /api/admin/upload/s3/abort  { key, uploadId }
// Called when the admin cancels or the page goes away. S3 keeps — and charges
// for — the parts of an unfinished multipart upload until it is aborted.
export const abortUpload = asyncHandler(async (req, res) => {
  if (STORAGE !== 's3') throw fail('Direct upload is only available when media is stored on S3')
  const { key, uploadId } = req.body || {}
  if (!key || !uploadId) throw fail('key and uploadId are required')
  await abortMultipart(String(key), String(uploadId))
  res.json({ ok: true })
})
