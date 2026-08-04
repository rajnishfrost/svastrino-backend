import { Blog } from './blog.model.js'

const httpError = (message, status) => {
  const err = new Error(message)
  err.status = status
  return err
}

const MAX_LIMIT = 50

/**
 * Paginated, filterable list of published posts (newest first).
 * @param {object} opts { page, limit, category, owner, q }
 */
export async function listBlogs({ page = 1, limit = 12, category, owner, q } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 12))

  const filter = { published: true }
  if (category) filter.categories = category
  if (owner) filter.owner = owner
  // Regex (not $text) so partial words match while typing.
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [{ title: rx }, { excerpt: rx }]
  }

  const [items, total] = await Promise.all([
    Blog.find(filter)
      .select('-body')
      .sort({ publishedAt: -1, order: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    Blog.countDocuments(filter),
  ])

  return {
    items,
    page: safePage,
    limit: safeLimit,
    total,
    pages: Math.max(1, Math.ceil(total / safeLimit)),
  }
}

/** One published post by slug. */
export async function getBlogBySlug(slug) {
  const post = await Blog.findOne({ slug, published: true })
  if (!post) throw httpError('Blog post not found', 404)
  return post
}

/**
 * Up to `limit` other posts to show under an article — same category first,
 * then most recent, never repeating the current post.
 */
export async function getRelated(post, limit = 3) {
  const base = { published: true, _id: { $ne: post._id } }

  const sameCategory = post.categories?.length
    ? await Blog.find({ ...base, categories: { $in: post.categories } })
        .select('-body')
        .sort({ publishedAt: -1 })
        .limit(limit)
    : []

  if (sameCategory.length >= limit) return sameCategory

  const fill = await Blog.find({
    ...base,
    _id: { $nin: [post._id, ...sameCategory.map((p) => p._id)] },
  })
    .select('-body')
    .sort({ publishedAt: -1 })
    .limit(limit - sameCategory.length)

  return [...sameCategory, ...fill]
}

/** Distinct categories with post counts, for the filter bar. */
export async function listCategories() {
  const rows = await Blog.aggregate([
    { $match: { published: true } },
    { $unwind: '$categories' },
    { $group: { _id: '$categories', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ])
  return rows.map((r) => ({ name: r._id, count: r.count }))
}

/** Newest N posts — used by the homepage strip. */
export async function listLatest(limit = 3) {
  return Blog.find({ published: true })
    .select('-body')
    .sort({ publishedAt: -1 })
    .limit(Math.min(12, Math.max(1, Number(limit) || 3)))
}
