import { Blog } from '../../user/blogs/blog.model.js'
import { ROWS_PER_PAGE } from '../../../utils/paginate.js'
import { LIMITS, optionalLink, raw, str, strList } from '../../../utils/validate.js'

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
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    // A slug is a public URL, so it is capped where a URL segment stops being
    // readable. Without this a 20,000-character title produced a 20,000-character
    // address, which every browser and every index would then truncate anyway.
    .slice(0, LIMITS.slug)

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Rough reading time so the card estimate stays honest after an edit. */
const readingMinsFor = (body) =>
  Math.max(1, Math.round(String(body || '').trim().split(/\s+/).filter(Boolean).length / 200))

// Categories, from either an array or a comma-separated string. Capped in both
// directions: a category name is a filter chip, and thirty of them on one post is
// not a taxonomy.
const asList = (v) =>
  [...new Set(
    Array.isArray(v)
      ? strList(v, { max: LIMITS.name, count: 30 })
      : str(v, LIMITS.longText).split(',').map((s) => str(s, LIMITS.name)).filter(Boolean).slice(0, 30)
  )]

/**
 * Paginated list for the admin table — drafts included, body stripped (a page
 * of long markdown bodies would be megabytes).
 * @param {object} opts { page, limit, q, category, owner, status }
 */
export async function listPosts({ page = 1, limit = ROWS_PER_PAGE, q, category, owner, status } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || ROWS_PER_PAGE))

  const filter = {}
  // Forced through `str` before any of it reaches the query. Express parses a
  // query string with qs, so "?category[$ne]=x" arrives as an OBJECT and Mongo
  // would read it as an operator — "every category" rather than one. Coercing to
  // a string is what makes these filters mean what they say.
  const term = str(q, LIMITS.search)
  if (category) filter.categories = str(category, LIMITS.name)
  if (owner) filter.owner = str(owner, LIMITS.slug)
  if (status === 'published') filter.published = true
  if (status === 'draft') filter.published = false
  if (term) {
    const rx = new RegExp(escapeRegExp(term), 'i')
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
  if (body.title !== undefined) patch.title = str(body.title, LIMITS.title)
  if (body.owner !== undefined) patch.owner = body.owner === 'nirmaan' ? 'nirmaan' : 'svastrino'
  if (body.author !== undefined) patch.author = str(body.author, LIMITS.name) || 'Svastrino'
  if (body.categories !== undefined) patch.categories = asList(body.categories)
  if (body.excerpt !== undefined) patch.excerpt = str(body.excerpt, LIMITS.description)
  // `raw`, not `str`: the body is Markdown, and a line beginning "> " is a
  // blockquote. Stripping angle brackets here would quietly rewrite every quote
  // in every post. It is still capped, and the renderer builds React elements
  // rather than HTML, so nothing tag-shaped in here can execute.
  if (body.body !== undefined) patch.body = raw(body.body, LIMITS.article)
  // Both of these end up in an href or a src, so they are held to being a real
  // link: http(s), or a path on this site that our own uploader produced.
  if (body.coverImage !== undefined) patch.coverImage = optionalLink(body.coverImage, { field: 'coverImage' })
  if (body.sourceUrl !== undefined) patch.sourceUrl = optionalLink(body.sourceUrl, { field: 'sourceUrl' })
  if (body.seoTitle !== undefined) patch.seoTitle = str(body.seoTitle, LIMITS.title)
  if (body.seoDescription !== undefined) patch.seoDescription = str(body.seoDescription, LIMITS.description)
  if (body.canonicalSlug !== undefined) patch.canonicalSlug = slugify(str(body.canonicalSlug, LIMITS.slug))
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
