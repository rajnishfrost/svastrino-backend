import { Testimonial } from '../../user/content/testimonial.model.js'

// Local, the way every other module here does it — there is no shared helper.
const httpError = (message, status) => Object.assign(new Error(message), { status })

/**
 * Reviews, as the team edits them. The public side only ever sees `active`
 * ones; this list is everything, so a review taken down is still here to put
 * back rather than gone for good.
 */
export async function listAll() {
  return Testimonial.find({}).sort({ order: 1, name: 1 })
}

/** Fields a person may set. Anything else in the body is ignored. */
const FIELDS = ['name', 'role', 'quote', 'photo', 'program', 'featured', 'order', 'active']

const clean = (body) => {
  const out = {}
  for (const f of FIELDS) if (body[f] !== undefined) out[f] = body[f]
  for (const f of ['name', 'role', 'quote', 'photo', 'program']) {
    if (out[f] !== undefined) out[f] = String(out[f]).trim()
  }
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
