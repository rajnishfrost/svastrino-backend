import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { mkdirSync, renameSync, unlinkSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { putFile, putBuffer, deleteObject, contentTypeFor, publicUrl } from './s3.js'

/**
 * Storage abstraction for uploaded media. Works in two modes, chosen by the
 * STORAGE env var — NOTHING else changes (controllers, DB, frontend all keep
 * using the returned URL):
 *   - local (default): files live under server/uploads, served at /uploads/*
 *   - s3:              files go to AWS S3, served via CloudFront (CDN_URL)
 *
 * Env to switch:  STORAGE=s3  S3_BUCKET=…  AWS_REGION=…  CDN_URL=https://…
 */
const __dir = dirname(fileURLToPath(import.meta.url))
export const UPLOADS_ROOT = join(__dir, '..', '..', 'uploads') // server/uploads
export const VIDEOS_DIR = join(UPLOADS_ROOT, 'videos')
export const HLS_DIR = join(UPLOADS_ROOT, 'hls') // one folder per video: master.m3u8 + variants
export const AVATARS_DIR = join(UPLOADS_ROOT, 'avatars') // square profile photos
export const REPORTS_DIR = join(UPLOADS_ROOT, 'reports') // re-hosted career report PDFs
export const IMAGES_DIR = join(UPLOADS_ROOT, 'images') // editorial images (blog covers)
export const SUBTITLES_DIR = join(UPLOADS_ROOT, 'subtitles') // caption VTT files
export const TMP_DIR = join(UPLOADS_ROOT, 'tmp') // multer staging before finalising

mkdirSync(VIDEOS_DIR, { recursive: true })
mkdirSync(HLS_DIR, { recursive: true })
mkdirSync(AVATARS_DIR, { recursive: true })
mkdirSync(REPORTS_DIR, { recursive: true })
mkdirSync(IMAGES_DIR, { recursive: true })
mkdirSync(SUBTITLES_DIR, { recursive: true })
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
    const res = await putFile(tmpPath, key, contentTypeFor(name))
    try { unlinkSync(tmpPath) } catch { /* already gone */ }
    return res // { url: CDN/S3 url, key }
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
    // Upload every file in the (flat) HLS output folder: master.m3u8 + variant
    // playlists + .ts segments. The master references the others by relative
    // name, so keeping them under the same `hls/${id}/` prefix just works.
    const files = readdirSync(localDir, { withFileTypes: true }).filter((d) => d.isFile())
    for (const f of files) {
      await putFile(join(localDir, f.name), `${key}/${f.name}`, contentTypeFor(f.name))
    }
    try { rmSync(localDir, { recursive: true, force: true }) } catch { /* best effort */ }
    return { masterUrl: publicUrl(`${key}/master.m3u8`), key }
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
    const res = await putFile(tmpPath, key, contentTypeFor(ext))
    try { unlinkSync(tmpPath) } catch { /* already gone */ }
    return res
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
    const res = await putFile(tmpPath, key, contentTypeFor(ext))
    try { unlinkSync(tmpPath) } catch { /* already gone */ }
    return res
  }

  renameSync(tmpPath, join(REPORTS_DIR, name))
  return { url: `/uploads/reports/${name}`, key }
}

/**
 * Persist an editorial image (blog cover art uploaded from the admin panel) and
 * return its public URL + storage key. `ext` includes the dot, e.g. '.jpg'.
 */
export async function saveImage(tmpPath, ext = '.jpg') {
  const name = crypto.randomBytes(12).toString('hex') + ext
  const key = `images/${name}`

  if (STORAGE === 's3') {
    const res = await putFile(tmpPath, key, contentTypeFor(ext))
    try { unlinkSync(tmpPath) } catch { /* already gone */ }
    return res
  }

  renameSync(tmpPath, join(IMAGES_DIR, name))
  return { url: `/uploads/images/${name}`, key }
}

/**
 * Persist a caption file as WebVTT (already converted from SRT by the caller)
 * and return its URL + key. Content is in-memory text, not a staged file.
 */
export async function saveSubtitle(vttText) {
  const name = crypto.randomBytes(12).toString('hex') + '.vtt'
  const key = `subtitles/${name}`

  if (STORAGE === 's3') {
    return putBuffer(vttText, key, 'text/vtt')
  }

  writeFileSync(join(SUBTITLES_DIR, name), vttText, 'utf8')
  return { url: `/uploads/subtitles/${name}`, key }
}

/**
 * Remove a stored asset by its key (e.g. 'avatars/ab.jpg'). Best-effort — a
 * missing file is fine. Remote (http) avatars have no key and are skipped.
 */
export async function deleteByKey(key) {
  if (!key) return
  if (STORAGE === 's3') {
    await deleteObject(key)
    return
  }
  try {
    unlinkSync(join(UPLOADS_ROOT, key))
  } catch {
    /* already gone — ignore */
  }
}

/**
 * Derive a storage key from a stored URL, so an old asset can be deleted when
 * it's replaced. Handles both modes:
 *   - local:  "/uploads/avatars/ab.jpg"            → "avatars/ab.jpg"
 *   - s3/CDN: "https://cdn…/avatars/ab.jpg"        → "avatars/ab.jpg"
 * Returns null for anything else (e.g. a remote Google avatar).
 */
export function keyFromUrl(url) {
  if (typeof url !== 'string' || !url) return null
  if (url.startsWith('/uploads/')) return url.slice('/uploads/'.length)

  const cdn = (process.env.CDN_URL || '').replace(/\/$/, '')
  if (cdn && url.startsWith(cdn + '/')) return url.slice(cdn.length + 1)

  // Fallback: an S3 REST URL — take the path after the first known prefix.
  const m = url.match(/\/(videos|hls|avatars|reports|images|subtitles)\/.+/)
  return m ? m[0].slice(1) : null
}
