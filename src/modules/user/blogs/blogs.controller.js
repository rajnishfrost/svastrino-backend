import { asyncHandler } from '../../../utils/asyncHandler.js'
import * as service from './blogs.service.js'
import { toBlogCardDTO, toBlogDTO } from './blogs.dto.js'

// GET /api/user/blogs?page=&limit=&category=&owner=&q=
export const list = asyncHandler(async (req, res) => {
  const { page, limit, category, owner, q } = req.query
  const result = await service.listBlogs({ page, limit, category, owner, q })
  res.json({
    posts: result.items.map(toBlogCardDTO),
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      pages: result.pages,
    },
  })
})

// GET /api/user/blogs/categories  → [{ name, count }]
export const categories = asyncHandler(async (req, res) => {
  res.json({ categories: await service.listCategories() })
})

// GET /api/user/blogs/latest?limit=3
export const latest = asyncHandler(async (req, res) => {
  const posts = await service.listLatest(req.query.limit)
  res.json({ posts: posts.map(toBlogCardDTO) })
})

// GET /api/user/blogs/:slug  → post + related
export const getBySlug = asyncHandler(async (req, res) => {
  const post = await service.getBlogBySlug(req.params.slug)
  const related = await service.getRelated(post, 3)
  res.json({ post: toBlogDTO(post), related: related.map(toBlogCardDTO) })
})
