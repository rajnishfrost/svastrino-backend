import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { mkdirSync, renameSync, unlinkSync } from 'node:fs'
import crypto from 'node:crypto'

/**
 * Storage abstraction for uploaded media. Today it's LOCAL disk; switching to
 * AWS S3 + CloudFront later means implementing the `s3` branch of the save/
 * delete helpers and setting env — NOTHING else changes (controller, DB, frontend
 * all keep using the returned URL). Same pattern as the payment gateway.
 *
 * Env to switch:  STORAGE=s3  S3_BUCKET=…  AWS_REGION=…  CDN_URL=https://…
 */
const __dir = dirname(fileURLToPath(import.meta.url))
export const UPLOADS_ROOT = join(__dir, '..', '..', 'uploads') // server/uploads
export const VIDEOS_DIR = join(UPLOADS_ROOT, 'videos')
export const HLS_DIR = join(UPLOADS_ROOT, 'hls') // one folder per video: master.m3u8 + variants
export const AVATARS_DIR = join(UPLOADS_ROOT, 'avatars') // square profile photos
export const REPORTS_DIR = join(UPLOADS_ROOT, 'reports') // re-hosted career report PDFs
export const TMP_DIR = join(UPLOADS_ROOT, 'tmp') // multer staging before finalising

mkdirSync(VIDEOS_DIR, { recursive: true })
mkdirSync(HLS_DIR, { recursive: true })
mkdirSync(AVATARS_DIR, { recursive: true })
mkdirSync(REPORTS_DIR, { recursive: true })
mkdirSync(TMP_DIR, { recursive: true })

export const STORAGE = process.env.STORAGE || 'local'

/**
 * Persist a just-uploaded temp file and return its public URL + storage key.
 * `tmpPath` is the multer-staged file; `originalName` is used only for the ext.
 */
export async function saveVideo(tmpPath, originalName) {
  const name = crypto.randomBytes(12).toString('hex') + (extname(originalName) || '.mp4')
  const key = `videos/${name}`

  if (STORAGE === 's3') {
    // TODO(S3): stream tmpPath → s3://S3_BUCKET/${key}, then unlink tmp, e.g.
    //   const client = new S3Client({ region: process.env.AWS_REGION })
    //   await client.send(new PutObjectCommand({
    //     Bucket: process.env.S3_BUCKET, Key: key,
    //     Body: createReadStream(tmpPath), ContentType: 'video/mp4',
    //   }))
    //   unlinkSync(tmpPath)
    //   return { url: `${process.env.CDN_URL}/${key}`, key }   // CloudFront URL
    throw new Error('S3 storage is not configured (set STORAGE=s3 + S3_BUCKET/AWS_REGION/CDN_URL)')
  }

  // local: move the staged file into the served videos dir
  renameSync(tmpPath, join(VIDEOS_DIR, name))
  return { url: `/uploads/videos/${name}`, key } // relative URL (Vite-proxied in dev)
}

/**
 * Persist a finished HLS output folder (master.m3u8 + variant playlists +
 * segments) and return the master playlist URL + storage key. `localDir` is a
 * temp folder produced by the transcoder; `id` is the video's public id.
 */
export async function saveHlsDir(localDir, id) {
  const key = `hls/${id}`

  if (STORAGE === 's3') {
    // TODO(S3): walk localDir and upload every file → s3://S3_BUCKET/${key}/…
    //   (Content-Type: .m3u8 → application/vnd.apple.mpegurl, .ts → video/mp2t),
    //   then rm -rf localDir.
    //   return { masterUrl: `${process.env.CDN_URL}/${key}/master.m3u8`, key }
    throw new Error('S3 storage is not configured for HLS output')
  }

  // local: move the whole folder into the served hls dir (same fs → atomic)
  renameSync(localDir, join(HLS_DIR, id))
  return { masterUrl: `/uploads/hls/${id}/master.m3u8`, key }
}

/**
 * Persist a cropped avatar image (the client sends a square JPEG) and return
 * its URL + storage key. `ext` includes the dot, e.g. '.jpg'.
 */
export async function saveAvatar(tmpPath, ext = '.jpg') {
  const name = crypto.randomBytes(12).toString('hex') + ext
  const key = `avatars/${name}`

  if (STORAGE === 's3') {
    // TODO(S3): putObject tmpPath → s3://S3_BUCKET/${key} (ContentType image/*),
    //   unlink tmp, return { url: `${process.env.CDN_URL}/${key}`, key }
    throw new Error('S3 storage is not configured for avatars')
  }

  renameSync(tmpPath, join(AVATARS_DIR, name))
  return { url: `/uploads/avatars/${name}`, key }
}

/**
 * Persist a career-report PDF (an admin re-hosts the file downloaded from the
 * Mindler partner portal, which is otherwise behind a login) and return its
 * public URL + storage key. `ext` includes the dot, e.g. '.pdf'.
 */
export async function saveReport(tmpPath, ext = '.pdf') {
  const name = crypto.randomBytes(12).toString('hex') + ext
  const key = `reports/${name}`

  if (STORAGE === 's3') {
    // TODO(S3): putObject tmpPath → s3://S3_BUCKET/${key} (ContentType application/pdf),
    //   unlink tmp, return { url: `${process.env.CDN_URL}/${key}`, key }
    throw new Error('S3 storage is not configured for report PDFs')
  }

  renameSync(tmpPath, join(REPORTS_DIR, name))
  return { url: `/uploads/reports/${name}`, key }
}

/**
 * Remove a stored asset by its key (e.g. 'avatars/ab.jpg'). Best-effort — a
 * missing file is fine. Remote (http) avatars have no key and are skipped.
 */
export async function deleteByKey(key) {
  if (!key) return
  if (STORAGE === 's3') {
    // TODO(S3): DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })
    return
  }
  try {
    unlinkSync(join(UPLOADS_ROOT, key))
  } catch {
    /* already gone — ignore */
  }
}

/** Derive a storage key from a locally-served URL, or null for remote URLs. */
export function keyFromUrl(url) {
  return typeof url === 'string' && url.startsWith('/uploads/') ? url.slice('/uploads/'.length) : null
}
