import multer from 'multer'
import crypto from 'node:crypto'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { TMP_DIR, saveImage } from '../../../config/uploads.js'

/**
 * Editorial image upload — blog cover art today, any other admin-authored
 * artwork later. Same shape as the video endpoint (multer stages to tmp, the
 * storage adapter decides the final home) but small and synchronous: no
 * transcoding, so there's nothing to poll.
 */
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex')),
})

const single = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    if (EXT[file.mimetype]) cb(null, true)
    else cb(Object.assign(new Error('Only JPG, PNG or WebP images are allowed'), { status: 400 }), false)
  },
}).single('image')

// Wrap multer so its errors (size limit, wrong type) become clean 400s.
export function uploadImageMw(req, res, next) {
  single(req, res, (err) => {
    if (err) {
      err.status = err.status || 400
      if (err.code === 'LIMIT_FILE_SIZE') err.message = 'Image is too large (max 8 MB)'
      return next(err)
    }
    next()
  })
}

// POST /api/admin/upload/image  (multipart field "image")
export const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    const err = new Error('No image received')
    err.status = 400
    throw err
  }
  const { url, key } = await saveImage(req.file.path, EXT[req.file.mimetype] || '.jpg')
  res.status(201).json({ url, key, size: req.file.size })
})
