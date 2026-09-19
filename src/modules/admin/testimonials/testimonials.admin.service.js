import { Testimonial } from '../../user/content/testimonial.model.js'
import { pageOf, pageResult } from '../../../utils/paginate.js'
import { LIMITS, optionalLink, str, text } from '../../../utils/validate.js'

// Local, the way every other module here does it — there is no shared helper.
const httpError = (message, status) => Object.assign(new Error(message), { status })

/**
 * Reviews, as the team edits them. The public side only ever sees `active`
 * ones; this list is everything, so a review taken down is still here to put
 * back rather than gone for good.
 */
export async function listAll({ page, limit } = {}) {
  const p = pageOf({ page, limit })
  const [items, total] = await Promise.all([
    Testimonial.find({}).sort({ order: 1, name: 1 }).skip(p.skip).limit(p.limit),
    Testimonial.countDocuments({}),
  ])
  return pageResult(items, total, p)
}

/** Fields a person may set. Anything else in the body is ignored. */
const FIELDS = ['name', 'role', 'quote', 'photo', 'program', 'featured', 'order', 'active']

// How long each text field may be. A review is quoted on a card, so `quote` is
// bounded by what that card can show before it starts pushing the section open —
// not by what somebody could paste into the box.
const CAPS = {
  name: LIMITS.name,
  role: LIMITS.shortText,
  program: LIMITS.name,
}

const clean = (body) => {
  const out = {}
  for (const f of FIELDS) if (body[f] !== undefined) out[f] = body[f]
  for (const [f, max] of Object.entries(CAPS)) {
    if (out[f] !== undefined) out[f] = str(out[f], max)
  }
  // The quote keeps its line breaks — some reviews are two short paragraphs.
  if (out.quote !== undefined) out.quote = text(out.quote, LIMITS.description)
  // A photo is rendered straight into a src, so it has to be a real link: an
  // http(s) URL, or a path on this site that our own uploader produced.
  if (out.photo !== undefined) out.photo = optionalLink(out.photo, { field: 'photo' })
  if (out.featured !== undefined) out.featured = !!out.featured
  if (out.active !== undefined) out.active = out.active !== false
  if (out.order !== undefined) out.order = Number(out.order) || 0
  return out
}

export async function create(body) {
  const data = clean(body || {})
  if (!data.name) throw httpError('Name is required', 400)
  if (!data.quote) throw httpError('The review itself is required', 400)
  if (data.order === undefined) {
    // New reviews land at the end rather than jumping the running order.
    const last = await Testimonial.findOne({}).sort({ order: -1 }).select('order').lean()
    data.order = (last?.order || 0) + 1
  }
  return Testimonial.create(data)
}

export async function update(id, body) {
  const data = clean(body || {})
  if (data.name === '') throw httpError('Name cannot be blank', 400)
  if (data.quote === '') throw httpError('The review cannot be blank', 400)
  const row = await Testimonial.findByIdAndUpdate(id, data, { new: true })
  if (!row) throw httpError('Review not found', 404)
  return row
}

export async function remove(id) {
  const row = await Testimonial.findByIdAndDelete(id)
  if (!row) throw httpError('Review not found', 404)
  return { deleted: true, name: row.name }
}
