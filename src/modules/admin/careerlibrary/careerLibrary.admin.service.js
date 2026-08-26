import { CareerField } from '../../user/content/careerField.model.js'
import { Course } from '../../user/content/course.model.js'

/**
 * Career Library management — streams (CareerField) and the course detail pages
 * filed under them (Course).
 *
 * Membership is stored on BOTH sides (CareerField.courses and Course.fields are
 * denormalised so neither page needs a join). To stop the two drifting, the
 * COURSE is the single source of truth: an admin picks a course's streams, and
 * `resyncField` rebuilds the stream's course list from that. Renaming a stream
 * propagates its new name into every course that references it.
 */
const httpError = (message, status) => {
  const err = new Error(message)
  err.status = status
  return err
}

export const slugify = (s) =>
  String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const asLines = (v) =>
  Array.isArray(v)
    ? v.map((s) => String(s).trim()).filter(Boolean)
    : String(v || '').split('\n').map((s) => s.trim()).filter(Boolean)

// ---- Streams (CareerField) --------------------------------------------------

/** Every stream, active or not — the admin list shows hidden ones too. */
export async function listFields() {
  return CareerField.find().sort({ order: 1, name: 1 })
}

async function getFieldOr404(id) {
  const field = await CareerField.findById(id)
  if (!field) throw httpError('Stream not found', 404)
  return field
}

/** Rebuild one stream's `courses` array from the courses that claim it. */
export async function resyncField(slug) {
  const courses = await Course.find({ 'fields.slug': slug, active: true }).sort({ name: 1 })
  await CareerField.updateOne(
    { slug },
    { $set: { courses: courses.map((c) => ({ name: c.name, slug: c.slug })) } }
  )
}

export async function createField(body = {}) {
  const name = String(body.name || '').trim()
  if (!name) throw httpError('Stream name is required', 400)

  const slug = slugify(body.slug || name)
  if (!slug) throw httpError('Slug must contain letters or numbers', 400)
  if (await CareerField.findOne({ slug })) throw httpError('A stream with this slug already exists', 409)

  return CareerField.create({
    slug,
    name,
    description: String(body.description || '').trim(),
    order: Number(body.order) || 0,
    active: body.active === undefined ? true : !!body.active,
    courses: [], // filled in from the course side
  })
}

export async function updateField(id, body = {}) {
  const field = await getFieldOr404(id)
  const prevName = field.name

  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) throw httpError('Stream name is required', 400)
    field.name = name
  }
  if (body.description !== undefined) field.description = String(body.description).trim()
  if (body.order !== undefined) field.order = Number(body.order) || 0
  if (body.active !== undefined) field.active = !!body.active

  await field.save()

  // Courses carry a copy of the stream name for their breadcrumb — keep it fresh.
  if (field.name !== prevName) {
    await Course.updateMany(
      { 'fields.slug': field.slug },
      { $set: { 'fields.$[f].name': field.name } },
      { arrayFilters: [{ 'f.slug': field.slug }] }
    )
  }
  return field
}

/**
 * Delete a stream. Courses are NOT deleted (one course can sit in several
 * streams) — they just stop referencing this one.
 */
export async function deleteField(id) {
  const field = await getFieldOr404(id)
  await Course.updateMany(
    { 'fields.slug': field.slug },
    { $pull: { fields: { slug: field.slug } } }
  )
  await field.deleteOne()
  return { ok: true }
}

// ---- Courses ----------------------------------------------------------------

const MAX_LIMIT = 100

/** Paginated course list with search + stream filter. Long text stripped. */
export async function listCourses({ page = 1, limit = 20, q, field, status } = {}) {
  const safePage = Math.max(1, Number(page) || 1)
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 20))

  const filter = {}
  if (field) filter['fields.slug'] = field
  if (status === 'active') filter.active = true
  if (status === 'hidden') filter.active = false
  if (q) {
    const rx = new RegExp(escapeRegExp(q), 'i')
    filter.$or = [{ name: rx }, { slug: rx }]
  }

  const [items, total] = await Promise.all([
    Course.find(filter).select('-overview -topJobs -careerLadder').sort({ name: 1 }).skip((safePage - 1) * safeLimit).limit(safeLimit),
    Course.countDocuments(filter),
  ])

  return { items, page: safePage, limit: safeLimit, total, pages: Math.max(1, Math.ceil(total / safeLimit)) }
}

export async function getCourse(id) {
  const course = await Course.findById(id)
  if (!course) throw httpError('Course not found', 404)
  return course
}

/** Resolve the submitted stream slugs into the [{ name, slug }] the model stores. */
async function resolveFields(slugs) {
  const wanted = [...new Set((Array.isArray(slugs) ? slugs : []).map((s) => String(s).trim()).filter(Boolean))]
  if (!wanted.length) return []
  const fields = await CareerField.find({ slug: { $in: wanted } })
  return fields.map((f) => ({ name: f.name, slug: f.slug }))
}

function buildCoursePatch(body = {}) {
  const patch = {}
  if (body.name !== undefined) patch.name = String(body.name).trim()
  if (body.overview !== undefined) patch.overview = String(body.overview).trim()
  if (body.topQualities !== undefined) patch.topQualities = asLines(body.topQualities)
  if (body.institutesIndia !== undefined) patch.institutesIndia = asLines(body.institutesIndia)
  if (body.institutesInternational !== undefined) patch.institutesInternational = asLines(body.institutesInternational)
  if (body.careerLadder !== undefined) patch.careerLadder = asLines(body.careerLadder)
  if (body.sourceUrl !== undefined) patch.sourceUrl = String(body.sourceUrl).trim()
  if (body.seoTitle !== undefined) patch.seoTitle = String(body.seoTitle).trim()
  if (body.seoDescription !== undefined) patch.seoDescription = String(body.seoDescription).trim()
  if (body.active !== undefined) patch.active = !!body.active
  if (body.topJobs !== undefined) {
    patch.topJobs = (Array.isArray(body.topJobs) ? body.topJobs : [])
      .map((j) => ({
        role: String(j?.role || '').trim(),
        description: String(j?.description || '').trim(),
        indiaSalary: String(j?.indiaSalary || '').trim(),
        globalSalary: String(j?.globalSalary || '').trim(),
      }))
      .filter((j) => j.role) // a job row with no role is an empty form row
  }
  return patch
}

export async function createCourse(body = {}) {
  const patch = buildCoursePatch(body)
  if (!patch.name) throw httpError('Course name is required', 400)

  const slug = slugify(body.slug || patch.name)
  if (!slug) throw httpError('Slug must contain letters or numbers', 400)
  if (await Course.findOne({ slug })) throw httpError('A course with this slug already exists', 409)

  const fields = await resolveFields(body.fields)
  const course = await Course.create({ ...patch, slug, fields })
  for (const f of fields) await resyncField(f.slug)
  return course
}

export async function updateCourse(id, body = {}) {
  const course = await getCourse(id)
  const patch = buildCoursePatch(body)
  if (patch.name !== undefined && !patch.name) throw httpError('Course name is required', 400)

  // Streams touched by this save — the old set plus the new one, so a stream a
  // course just LEFT also gets rebuilt.
  const touched = new Set(course.fields.map((f) => f.slug))

  if (body.fields !== undefined) {
    const fields = await resolveFields(body.fields)
    fields.forEach((f) => touched.add(f.slug))
    course.fields = fields
  }

  if (body.slug !== undefined) {
    const slug = slugify(body.slug)
    if (!slug) throw httpError('Slug must contain letters or numbers', 400)
    if (slug !== course.slug) {
      const clash = await Course.findOne({ slug, _id: { $ne: course._id } })
      if (clash) throw httpError('A course with this slug already exists', 409)
      // Nor onto an address another page is still redirecting from.
      const held = await Course.findOne({ previousSlugs: slug, _id: { $ne: course._id } })
      if (held) throw httpError(`“${slug}” still redirects to “${held.slug}” — free it there first`, 409)
      // Remember where this page used to live, so the old address keeps
      // working instead of becoming a 404. A slug coming back to one it held
      // before is dropped from the list — otherwise it would redirect to
      // itself.
      course.previousSlugs = [...new Set([...(course.previousSlugs || []), course.slug])]
        .filter((s) => s && s !== slug)
      course.slug = slug
    }
  }

  Object.assign(course, patch)
  await course.save()
  // Name / slug / active changes all alter what a stream should list.
  for (const slug of touched) await resyncField(slug)
  return course
}

export async function deleteCourse(id) {
  const course = await getCourse(id)
  const slugs = course.fields.map((f) => f.slug)
  await course.deleteOne()
  for (const slug of slugs) await resyncField(slug)
  return { ok: true }
}

