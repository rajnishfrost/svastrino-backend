import { Router } from 'express'
import { asyncHandler } from '../../../utils/asyncHandler.js'
import { requireAdminAuth, requirePermission } from '../../../middleware/auth.js'
import * as service from './blogs.admin.service.js'

// Mounted at /api/admin/blogs — gated by the 'blogs' module.
const router = Router()
router.use(requireAdminAuth, requirePermission('blogs'))

// Row shape for the admin table — no body (see listPosts).
const rowDTO = (p) => ({
  id: String(p._id),
  slug: p.slug,
  title: p.title,
  owner: p.owner,
  author: p.author,
  categories: p.categories,
  excerpt: p.excerpt,
  coverImage: p.coverImage,
  sourceUrl: p.sourceUrl,
  publishedAt: p.publishedAt,
  readingMins: p.readingMins,
  published: p.published,
  order: p.order,
  updatedAt: p.updatedAt,
})
// Full shape for the editor.
const postDTO = (p) => ({ ...rowDTO(p), body: p.body })

// GET /api/admin/blogs?page=&limit=&q=&category=&owner=&status=
router.get('/', asyncHandler(async (req, res) => {
  const result = await service.listPosts(req.query)
  res.json({
    posts: result.items.map(rowDTO),
    pagination: { page: result.page, limit: result.limit, total: result.total, pages: result.pages },
  })
}))

// Must stay above '/:id' or the param route swallows it.
router.get('/categories', asyncHandler(async (req, res) => {
  res.json({ categories: await service.listAllCategories() })
}))

router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ post: postDTO(await service.getPost(req.params.id)) })
}))

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json({ post: postDTO(await service.createPost(req.body || {})) })
}))

router.patch('/:id', asyncHandler(async (req, res) => {
  res.json({ post: postDTO(await service.updatePost(req.params.id, req.body || {})) })
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  res.json(await service.deletePost(req.params.id))
}))

export default router
