import multer from 'multer'
import crypto from 'node:crypto'
import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { TMP_DIR, UPLOADS_ROOT, saveSubtitle, deleteByKey } from '../../../config/uploads.js'
import { srtToVtt, parseVttCues, buildVtt } from '../../../utils/subtitles.js'
import { translateCues } from '../../../utils/aiTranslate.js'
import { Session } from '../../user/learn/session.model.js'

/**
 * Caption tracks for a course session. Admin uploads an .srt (or .vtt) per
 * language; we convert SRT → WebVTT (timestamps untouched) and store it. The
 * player then offers a subtitle selector. A track can also be auto-translated
 * from an existing language via OpenAI (cue text translated, timing copied).
 */
const httpError = (m, s = 400) => Object.assign(new Error(m), { status: s })

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex')),
})
const single = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB — captions are tiny
  fileFilter: (req, file, cb) => {
    const ok = /\.(srt|vtt)$/i.test(file.originalname) ||
      ['text/vtt', 'application/x-subrip', 'text/plain', 'application/octet-stream'].includes(file.mimetype)
    cb(ok ? null : httpError('Upload a .srt or .vtt file'), ok)
  },
}).single('file')

export function uploadCaptionMw(req, res, next) {
  single(req, res, (err) => {
    if (err) { err.status = err.status || 400; if (err.code === 'LIMIT_FILE_SIZE') err.message = 'Caption file too large (max 2 MB)'; return next(err) }
    next()
  })
}

const captionsDTO = (s) => (s.captions || []).map((c) => ({ lang: c.lang, label: c.label, url: c.url }))

// Replace-or-add a track for a language on the session, deleting the old file.
async function upsertTrack(session, { lang, label, url, key }) {
  const existing = session.captions.find((c) => c.lang === lang)
  if (existing?.key) await deleteByKey(existing.key).catch(() => {})
  session.captions = session.captions.filter((c) => c.lang !== lang)
  session.captions.push({ lang, label, url, key })
  await session.save()
}

// POST /api/admin/sessions/:id/captions   (multipart "file" + fields lang,label)
export const uploadCaption = asyncHandler(async (req, res) => {
  const session = await Session.findById(req.params.id)
  if (!session) throw httpError('Session not found', 404)
  if (!req.file) throw httpError('No caption file received')

  const lang = String(req.body.lang || '').trim().toLowerCase()
  const label = String(req.body.label || '').trim() || lang.toUpperCase()
  if (!/^[a-z]{2}(-[a-z]{2,})?$/i.test(lang)) throw httpError('Enter a valid language code (e.g. hi, en)')

  const raw = readFileSync(req.file.path, 'utf8')
  try { unlinkSync(req.file.path) } catch { /* ignore */ }
  const vtt = srtToVtt(raw)
  if (!parseVttCues(vtt).length) throw httpError('That file has no readable captions')

  const { url, key } = await saveSubtitle(vtt)
  await upsertTrack(session, { lang, label, url, key })
  res.status(201).json({ captions: captionsDTO(session) })
})

// DELETE /api/admin/sessions/:id/captions/:lang
export const deleteCaption = asyncHandler(async (req, res) => {
  const session = await Session.findById(req.params.id)
  if (!session) throw httpError('Session not found', 404)
  const lang = String(req.params.lang || '').toLowerCase()
  const track = session.captions.find((c) => c.lang === lang)
  if (track?.key) await deleteByKey(track.key).catch(() => {})
  session.captions = session.captions.filter((c) => c.lang !== lang)
  await session.save()
  res.json({ captions: captionsDTO(session) })
})

// Read a stored VTT back (local file or remote CDN URL) so it can be translated.
async function readTrackVtt(track) {
  if (track.url?.startsWith('/uploads/')) {
    return readFileSync(join(UPLOADS_ROOT, track.url.slice('/uploads/'.length)), 'utf8')
  }
  const res = await fetch(track.url)
  if (!res.ok) throw httpError('Could not read the source caption file', 502)
  return res.text()
}

// POST /api/admin/sessions/:id/captions/:lang/translate  { targetLang, targetLabel }
export const translateCaption = asyncHandler(async (req, res) => {
  const session = await Session.findById(req.params.id)
  if (!session) throw httpError('Session not found', 404)
  const source = session.captions.find((c) => c.lang === String(req.params.lang || '').toLowerCase())
  if (!source) throw httpError('Source caption language not found', 404)

  const targetLang = String(req.body.targetLang || '').trim().toLowerCase()
  const targetLabel = String(req.body.targetLabel || '').trim() || targetLang.toUpperCase()
  if (!/^[a-z]{2}(-[a-z]{2,})?$/i.test(targetLang)) throw httpError('Enter a valid target language code')
  if (targetLang === source.lang) throw httpError('Pick a different target language')

  const cues = parseVttCues(await readTrackVtt(source))
  if (!cues.length) throw httpError('Source captions are empty')

  const translated = await translateCues(cues.map((c) => c.text), source.label, targetLabel)
  const outCues = cues.map((c, i) => ({ ...c, text: translated[i] ?? c.text }))
  const { url, key } = await saveSubtitle(buildVtt(outCues))
  await upsertTrack(session, { lang: targetLang, label: targetLabel, url, key })
  res.status(201).json({ captions: captionsDTO(session) })
})
