import multer from 'multer'
import crypto from 'node:crypto'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { TMP_DIR, saveAvatar } from '../../../config/uploads.js'
import { toUserDTO } from './credentials.dto.js'
import * as service from './credentials.service.js'

// The client sends an already-cropped square image, so limits stay small.
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex')),
})

const single = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (EXT[file.mimetype]) cb(null, true)
    else cb(Object.assign(new Error('Only JPG, PNG or WebP images are allowed'), { status: 400 }), false)
  },
}).single('avatar')

// Wrap multer so its errors become clean 400s.
export function uploadAvatarMw(req, res, next) {
  single(req, res, (err) => {
    if (err) {
      err.status = err.status || 400
      if (err.code === 'LIMIT_FILE_SIZE') err.message = 'Image is too large (max 5 MB)'
      return next(err)
    }
    next()
  })
}

// POST /api/user/profile/avatar  (multipart field "avatar", requireUserAuth)
export const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) {
    const err = new Error('No image received')
    err.status = 400
    throw err
  }
  const { url } = await saveAvatar(req.file.path, EXT[req.file.mimetype] || '.jpg')
  const user = await service.updateAvatar(req.user.id, url)
  res.status(201).json({ user: toUserDTO(user) })
})

// DELETE /api/user/profile/avatar  (requireUserAuth)
export const removeAvatar = asyncHandler(async (req, res) => {
  const user = await service.updateAvatar(req.user.id, '')
  res.json({ user: toUserDTO(user) })
})
