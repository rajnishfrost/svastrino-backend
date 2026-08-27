import { Blog } from '../../user/blogs/blog.model.js'

/**
 * Blog management for the admin panel. Deliberately separate from the public
 * blogs service: that one only ever sees `published: true` posts and strips the
 * body from listings. Admins need drafts, the full record, and write access.
 */
const httpError = (message, status) => {
  const err = new Error(message)
  err.status = status
  return err
}

const MAX_LIMIT = 100

export const slugify = (s) =>
  String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Rough reading time so the card estimate stays honest after an edit. */
const readingMinsFor = (body) =>
  Math.max(1, Math.round(String(body || '').trim().split(/\s+/).filter(Boolean).length / 200))

const asList = (v) =>
  Array.isArray(v)
    ? [...new Set(v.map((s) => String(s).trim()).filter(Boolean))]
    : String(v || '').split(',').map((s) => s.trim()).filter(Boolean)

/**
 * Paginated list for the admin table — drafts included, body stripped (a page
 * of long markdown bodies would be megabytes).
 * @param {object} opts { page, limit, q, category, owner, status }
 */
export async function listPosts({ page = 1, limit = 20, q, category, owner, status } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 20))

  const filter = {}
  if (category) filter.categories = category
  if (owner) filter.owner = owner
  if (status === 'published') filter.published = true
  if (status === 'draft') filter.published = false
  if (q) {
    const rx = new RegExp(escapeRegExp(q), 'i')
    filter.$or = [{ title: rx }, { excerpt: rx }, { slug: rx }, { author: rx }]
  }

  const [items, total] = await Promise.all([
    Blog.find(filter)
      .select('-body')
      .sort({ publishedAt: -1, order: 1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    Blog.countDocuments(filter),
  ])

  return { items, page: safePage, limit: safeLimit, total, pages: Math.max(1, Math.ceil(total / safeLimit)) }
}

/** One post by id — full record, published or not. */
export async function getPost(id) {
  const post = await Blog.findById(id)
  if (!post) throw httpError('Blog post not found', 404)
  return post
}

/** Every category in use (drafts included), so the filter never hides a draft. */
export async function listAllCategories() {
  const rows = await Blog.aggregate([
    { $unwind: '$categories' },
    { $group: { _id: '$categories', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ])
  return rows.map((r) => ({ name: r._id, count: r.count }))
}

/**
 * Shape an incoming payload into model fields. Only keys actually present are
 * returned, so a PATCH never blanks a field the form didn't send.
 */
function buildPatch(body = {}) {
  const patch = {}
  if (body.title !== undefined) patch.title = String(body.title).trim()
  if (body.owner !== undefined) patch.owner = body.owner === 'nirmaan' ? 'nirmaan' : 'svastrino'
  if (body.author !== undefined) patch.author = String(body.author).trim() || 'Svastrino'
  if (body.categories !== undefined) patch.categories = asList(body.categories)
  if (body.excerpt !== undefined) patch.excerpt = String(body.excerpt).trim()
  if (body.body !== undefined) patch.body = String(body.body)
  if (body.coverImage !== undefined) patch.coverImage = String(body.coverImage).trim()
  if (body.sourceUrl !== undefined) patch.sourceUrl = String(body.sourceUrl).trim()
  if (body.seoTitle !== undefined) patch.seoTitle = String(body.seoTitle).trim()
  if (body.seoDescription !== undefined) patch.seoDescription = String(body.seoDescription).trim()
  if (body.canonicalSlug !== undefined) patch.canonicalSlug = slugify(body.canonicalSlug)
  if (body.published !== undefined) patch.published = !!body.published
  if (body.order !== undefined) patch.order = Number(body.order) || 0
  if (body.publishedAt) {
    const d = new Date(body.publishedAt)
    if (!Number.isNaN(d.getTime())) patch.publishedAt = d
  }
  // Reading time is derived, but stays overridable if an admin types one in.
  if (body.readingMins !== undefined && body.readingMins !== '') {
    patch.readingMins = Math.max(1, Number(body.readingMins) || 1)
  } else if (patch.body !== undefined) {
    patch.readingMins = readingMinsFor(patch.body)
  }
  return patch
}

export async function createPost(body = {}) {
  const patch = buildPatch(body)
  if (!patch.title) throw httpError('Title is required', 400)

  const slug = slugify(body.slug || patch.title)
  if (!slug) throw httpError('Slug must contain letters or numbers', 400)
  if (await Blog.findOne({ slug })) throw httpError('A post with this slug already exists', 409)

  return Blog.create({ ...patch, slug })
}

export async function updatePost(id, body = {}) {
  const post = await getPost(id)
  const patch = buildPatch(body)
  if (patch.title !== undefined && !patch.title) throw httpError('Title is required', 400)

  // The slug is a public URL — only change it when explicitly asked, and never
  // onto one another post already owns.
  if (body.slug !== undefined) {
    const slug = slugify(body.slug)
    if (!slug) throw httpError('Slug must contain letters or numbers', 400)
    if (slug !== post.slug) {
      const clash = await Blog.findOne({ slug, _id: { $ne: post._id } })
      if (clash) throw httpError('A post with this slug already exists', 409)
      // Nor onto an address another page is still redirecting from.
      const held = await Blog.findOne({ previousSlugs: slug, _id: { $ne: post._id } })
      if (held) throw httpError(`“${slug}” still redirects to “${held.slug}” — free it there first`, 409)
      patch.slug = slug
      // Remember where this page used to live, so the old address keeps
      // working instead of becoming a 404. A slug coming back to one it held
      // before is dropped from the list — otherwise it would redirect to
      // itself.
      post.previousSlugs = [...new Set([...(post.previousSlugs || []), post.slug])]
        .filter((s) => s && s !== slug)

    }
  }

  Object.assign(post, patch)
  await post.save()
  return post
}

export async function deletePost(id) {
  const post = await getPost(id)
  await post.deleteOne()
  return { ok: true }
}
