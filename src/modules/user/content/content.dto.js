/** Compact program shape for the mentoring list cards. */
export function toProgramCardDTO(p) {
  return {
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    trustLine: p.trustLine || '',
    summary: p.summary,
    duration: p.duration,
    sessions: p.sessions,
    mode: p.mode,
    category: p.category?.slug ? { slug: p.category.slug, name: p.category.name } : null,
    bookingSku: p.bookingSku || '',
    buyMode: p.buyMode || 'self-serve',
  }
}

/** Full program shape for the detail view (journey, benefits, brochure). */
export function toProgramDTO(p) {
  return {
    ...toProgramCardDTO(p),
    chooseIf: p.chooseIf,
    journey: p.journey.map((s) => ({
      label: s.label,
      title: s.title,
      description: s.description,
    })),
    benefits: p.benefits,
    brochureUrl: p.brochureUrl,
    faqs: (p.faqs || []).map((f) => ({ q: f.q, a: f.a })),
  }
}

export function toFaqDTO(f) {
  return { id: String(f._id), section: f.section, question: f.question, answer: f.answer }
}

export function toTestimonialDTO(t) {
  return {
    id: String(t._id),
    name: t.name,
    role: t.role,
    quote: t.quote,
    photo: t.photo,
    program: t.program,
    featured: t.featured,
  }
}

export function toCareerFieldDTO(c) {
  return {
    slug: c.slug,
    name: c.name,
    description: c.description,
    courseCount: c.courses.length,
    courses: c.courses.map((x) => ({ name: x.name, slug: x.slug })),
  }
}

export function toSitePageDTO(p) {
  return { slug: p.slug, title: p.title, body: p.body, updatedAt: p.updatedAt }
}

export function toCourseDTO(c) {
  return {
    slug: c.slug,
    name: c.name,
    overview: c.overview,
    topQualities: c.topQualities,
    topJobs: c.topJobs.map((j) => ({
      role: j.role,
      description: j.description,
      indiaSalary: j.indiaSalary,
      globalSalary: j.globalSalary,
    })),
    institutesIndia: c.institutesIndia,
    institutesInternational: c.institutesInternational,
    careerLadder: c.careerLadder,
    fields: c.fields.map((f) => ({ name: f.name, slug: f.slug })),
    // Empty unless an admin has set one; the page then falls back to the
    // wording the old site published for this address.
    seoTitle: c.seoTitle || '',
    seoDescription: c.seoDescription || '',
  }
}
