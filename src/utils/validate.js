/**
 * The server half of the validation contract. Mirrors client/src/utils/validate.js
 * limit for limit and regex for regex.
 *
 * Why both: the browser copy exists so a visitor is told what is wrong while they
 * are still looking at the field. THIS copy is the one that decides, because a
 * request never has to come from our page — curl, a script, a replayed form post
 * and a stale cached bundle all reach the same routes. Every rule that matters is
 * enforced here, and the client is allowed to be nothing more than good manners.
 *
 * The helpers come in two shapes:
 *   str / text / lower  — normalise and truncate, never throw
 *   requireX / optionalX — normalise, then throw a 400 when the value is unusable
 *
 * Truncating rather than rejecting on length is deliberate for the first group.
 * A field that is 3 characters over its cap is a UI that let someone type too
 * much, not an attack, and refusing the whole submission over it loses the
 * message. Anything that is actively wrong — a malformed email, a phone with no
 * country code, a payload with a script in it — is refused outright.
 */

/* ---------------------------------------------------------------- limits ---- */

/** Keep in step with LIMITS in client/src/utils/validate.js. */
export const LIMITS = {
  name: 60,
  email: 254,
  phone: 20,
  city: 80,
  state: 80,
  address: 240,
  pincode: 10,
  studentClass: 40,
  subject: 120,
  message: 2000,
  ticketMessage: 4000,
  answer: 4000,
  notes: 2000,
  couponCode: 24,
  search: 80,
  password: 128,
  url: 300,
  slug: 80,
  title: 160,
  shortText: 200,
  description: 1200,
  longText: 20000,
  /*
   * A whole article. Set above what the JSON body parser will accept (100 kB)
   * on purpose: the point of a cap on a field an admin writes over several
   * sittings is to be a backstop, not a guillotine. The longest post we already
   * hold is just under 20,000 characters, and silently clipping somebody's work
   * on save is worse than any request this would have turned away — the parser
   * refuses the oversized request first, with an error, before we see it.
   */
  article: 100000,
}

export const MINIMUMS = {
  name: 2,
  subject: 3,
  message: 10,
  answer: 2,
  phoneDigits: 8,
}

/* --------------------------------------------------------------- patterns --- */

export const EMAIL_RE = /^[^\s@<>]+@[^\s@<>.]+(?:\.[^\s@<>.]+)+$/
export const NAME_RE = /^\p{L}[\p{L}\p{M}\s'.-]*$/u
export const PLACE_RE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}\s'.,()/-]*$/u
export const PHONE_E164_RE = /^\+[1-9]\d{7,14}$/
export const COUPON_RE = /^[A-Z0-9][A-Z0-9-]{2,23}$/
export const PINCODE_RE = /^\d{4,10}$/
export const URL_RE = /^https?:\/\/[^\s<>"']+$/i
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/* --------------------------------------------------------------- failures --- */

/** A 400 carrying the field it is about, so the client can mark that box. */
export function badRequest(message, field) {
  const err = new Error(message)
  err.status = 400
  if (field) err.field = field
  return err
}

const fail = (message, field) => {
  throw badRequest(message, field)
}

/* ------------------------------------------------------------ sanitising --- */

const CONTROL_SOURCE =
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]'
const CONTROL_RE = new RegExp(CONTROL_SOURCE, 'g')

/**
 * Drop the characters that let stored text act as markup, and the invisible ones.
 *
 * The angle brackets go because this data leaves the database through channels
 * that do NOT escape by themselves: the notification emails we send the team,
 * and the CSV exports they open in Excel. The invisible characters go because a
 * zero-width space inside an email address, or a bidi override inside a name, is
 * only ever there to make one string look like another.
 */
export const stripMarkup = (v) => String(v ?? '').replace(/[<>]/g, '').replace(CONTROL_RE, '')

/** A one-line value, normalised and cut to `max`. Never throws. */
export const str = (v, max = LIMITS.shortText) =>
  stripMarkup(v).replace(/\s+/g, ' ').trim().slice(0, max)

/** A paragraph value: newlines kept, blank-line walls collapsed, cut to `max`. */
export const text = (v, max = LIMITS.message) =>
  stripMarkup(v)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)

export const lower = (v, max = LIMITS.shortText) => str(v, max).toLowerCase()

/**
 * A capped value that keeps its angle brackets.
 *
 * For the one kind of field where stripping them would be destruction rather than
 * defence: Markdown bodies, where a line beginning "> " is a blockquote. These
 * are written by an admin behind a permission check and rendered by a Markdown
 * component that builds React elements and never touches innerHTML, so a stray
 * tag in there renders as the literal text somebody typed. The cap and the
 * control-character strip still apply — those are what this is for.
 */
export const raw = (v, max = LIMITS.longText) =>
  String(v ?? '').replace(CONTROL_RE, '').replace(/\r\n?/g, '\n').slice(0, max)

export const digits = (v, max = LIMITS.phone) => String(v ?? '').replace(/\D+/g, '').slice(0, max)

/** Digits with the leading + preserved: the E.164 shape a country picker sends. */
export const phoneStr = (v) => {
  const s = String(v ?? '').trim()
  const plus = s.startsWith('+') ? '+' : ''
  return `${plus}${s.replace(/\D+/g, '')}`.slice(0, LIMITS.phone)
}

export const couponStr = (v) =>
  String(v ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, LIMITS.couponCode)

/* ------------------------------------------------- what is not human text --- */

const CODE_SIGNATURES = [
  /*
   * A markup tag, by name.
   *
   * Named, and with no space allowed after the bracket.
   *
   * The obvious pattern for "a tag" is <something>, and that also matches "if 5 <
   * 10 and 10 > 3" in a perfectly ordinary sentence — a contact form that refuses
   * that is a contact form that loses a real enquiry. Requiring the name to follow
   * the bracket immediately rules out every "x < y" comparison, and naming the
   * tags rules out the rest of prose: nobody writes "I scored <img" by accident.
   */
  /<\/?(?:script|iframe|object|embed|svg|img|a|div|span|p|style|link|meta|form|input|textarea|button|body|html|base|frame|frameset|applet|audio|video|source|math|marquee)\b/i,
  /javascript\s*:/i,
  /data\s*:\s*text\/html/i,
  /\bon(?:error|load|click|focus|mouseover|submit|toggle)\s*=/i,
  /\$\{[\s\S]*\}/,
  /\{\{[\s\S]*\}\}/,
  /<\?(?:php|=)/i,
  /\b(?:union\s+all\s+select|union\s+select|drop\s+table|insert\s+into|delete\s+from|update\s+\S+\s+set)\b/i,
  /\bselect\b[\s\S]{1,80}\bfrom\b[\s\S]{1,40}\bwhere\b/i,
  /\b(?:document|window)\s*\.\s*(?:cookie|location|write)\b/i,
  /\beval\s*\(|\bnew\s+Function\s*\(/,
]

export const looksLikeCode = (v) => {
  const s = String(v ?? '')
  return CODE_SIGNATURES.some((re) => re.test(s))
}

export const isMostlySymbols = (v, ratio = 0.4) => {
  const s = String(v ?? '').trim()
  if (s.length < 8) return false
  const words = (s.match(/[\p{L}\p{N}]/gu) || []).length
  return words / s.length < ratio
}

const CODE_MSG = 'Please write this as plain text — code and script are not allowed here.'

/** Refuse a value that is trying to be executed, or that is not words at all. */
export const assertHumanText = (raw, field, { prose = false } = {}) => {
  if (looksLikeCode(raw)) fail(CODE_MSG, field)
  if (prose && isMostlySymbols(raw)) fail('Please write this in words so we can read it.', field)
}

/* --------------------------------------------------------- field checkers --- */

export function requireName(raw, { field = 'name', label = 'name' } = {}) {
  const v = str(raw, LIMITS.name)
  if (!v) fail(`Please enter your ${label}`, field)
  if (v.length < MINIMUMS.name) fail(`That ${label} is too short`, field)
  if (!NAME_RE.test(v)) fail(`Please use letters only in your ${label} — spaces, . - and ' are fine`, field)
  return v
}

export function optionalName(raw, opts = {}) {
  return str(raw, LIMITS.name) ? requireName(raw, opts) : ''
}

export function requireEmail(raw, { field = 'email' } = {}) {
  const v = lower(raw, LIMITS.email + 1)
  if (!v) fail('Please enter your email address', field)
  if (v.length > LIMITS.email) fail('That email address is too long', field)
  if (!EMAIL_RE.test(v)) fail('That does not look like an email address', field)
  return v
}

export function optionalEmail(raw, opts = {}) {
  return lower(raw, LIMITS.email + 1) ? requireEmail(raw, opts) : ''
}

/**
 * A phone number with its country code.
 *
 * Every phone field on the site is now a country picker plus a number, so a bare
 * national number no longer reaches us from our own pages. It is still accepted
 * here, with +91 assumed, for two reasons: the CSV roster importer carries
 * numbers typed into a spreadsheet by a school office, and accounts created
 * before the picker existed hold numbers in that older shape. Anything that is
 * not a plausible number at all is refused.
 */
export function requirePhone(raw, { field = 'phone', defaultDial = '91' } = {}) {
  let v = phoneStr(raw)
  const bare = v.replace(/\D/g, '')
  if (!bare) fail('Please enter your phone number', field)
  if (!v.startsWith('+')) {
    // 10 digits is an Indian mobile typed without its code. More than that and
    // we cannot tell a missing + from a mistyped number, so we do not guess.
    if (bare.length === 10) v = `+${defaultDial}${bare}`
    else fail('Please include your country code, for example +91', field)
  }
  const d = v.replace(/\D/g, '')
  if (d.length < MINIMUMS.phoneDigits) fail('That phone number is too short', field)
  if (d.length > 15) fail('That phone number is too long', field)
  if (!PHONE_E164_RE.test(v)) fail('That phone number does not look right', field)
  return v
}

export function optionalPhone(raw, opts = {}) {
  return phoneStr(raw).replace(/\D/g, '') ? requirePhone(raw, opts) : ''
}

/** A one-line free-text field. Truncates at `max`; refuses code. */
export function requireLine(raw, { field, label = 'this', min = 0, max = LIMITS.shortText } = {}) {
  assertHumanText(raw, field)
  const v = str(raw, max)
  if (!v) fail(`Please fill in ${label}`, field)
  if (v.length < min) fail(`Please write a little more in ${label}`, field)
  return v
}

export function optionalLine(raw, { field, max = LIMITS.shortText } = {}) {
  const v = str(raw, max)
  if (v) assertHumanText(raw, field)
  return v
}

/** A paragraph field. Truncates at `max`; refuses code and symbol soup. */
export function requireText(raw, { field, label = 'this', min = 0, max = LIMITS.message } = {}) {
  assertHumanText(raw, field, { prose: true })
  const v = text(raw, max)
  if (!v) fail(`Please fill in ${label}`, field)
  if (v.length < min) fail(`Please write at least ${min} characters in ${label}`, field)
  return v
}

export function optionalText(raw, { field, max = LIMITS.message } = {}) {
  const v = text(raw, max)
  if (v) assertHumanText(raw, field, { prose: true })
  return v
}

export function requirePlace(raw, { field = 'city', label = 'city', max = LIMITS.city } = {}) {
  const v = str(raw, max)
  if (!v) fail(`Please tell us your ${label}`, field)
  if (!PLACE_RE.test(v)) fail(`Please use letters and digits only in your ${label}`, field)
  return v
}

export function optionalPlace(raw, opts = {}) {
  return str(raw, opts.max ?? LIMITS.city) ? requirePlace(raw, opts) : ''
}

export function optionalUrl(raw, { field, max = LIMITS.url } = {}) {
  const v = str(raw, max + 1)
  if (!v) return ''
  if (v.length > max) fail('That link is too long', field)
  if (!URL_RE.test(v)) fail('Please enter a full link, starting with https://', field)
  return v
}

/**
 * A link that may be ours or somebody else's: an absolute http(s) URL, or a path
 * on this site beginning with a single slash.
 *
 * The relative half is not a convenience — it is what our own uploader returns.
 * saveReport hands back "/uploads/reports/<name>.pdf" when storage is local, so a
 * validator that insisted on a scheme would reject every report an admin attached
 * on a local-storage deployment. What it will not accept is a scheme-relative
 * "//evil.example" or anything with a colon in front of the path, which is how
 * "javascript:" and "data:text/html" get into an href.
 */
export function optionalLink(raw, { field, max = LIMITS.url } = {}) {
  const v = str(raw, max + 1)
  if (!v) return ''
  if (v.length > max) fail('That link is too long', field)
  const relative = v.startsWith('/') && !v.startsWith('//')
  if (!relative && !URL_RE.test(v)) {
    fail('Please enter a full link starting with https://, or a path on this site', field)
  }
  return v
}

export function optionalPincode(raw, { field = 'pincode' } = {}) {
  const v = digits(raw, LIMITS.pincode)
  if (!v) return ''
  if (!PINCODE_RE.test(v)) fail('That PIN code does not look right', field)
  return v
}

export function optionalCoupon(raw, { field = 'couponCode' } = {}) {
  const v = couponStr(raw)
  if (!v) return ''
  if (!COUPON_RE.test(v)) fail('A coupon code is letters, digits and dashes only', field)
  return v
}

/**
 * A slug we generated ourselves — a course, a page, a blog post.
 *
 * `message` is there because the advice differs by field: for a support ticket the
 * useful thing to say is that the box can be left empty, and a generic "choose
 * from the list" would leave the student hunting for an option that means "none".
 */
export function optionalSlug(raw, { field, max = LIMITS.slug, message } = {}) {
  const v = lower(raw, max)
  if (!v) return ''
  if (!SLUG_RE.test(v)) fail(message || 'Please choose from the list rather than typing a value', field)
  return v
}

/**
 * A whole number inside a range, for the "how many days" style of field.
 *
 * `label` completes "Please enter …", so it reads as a phrase rather than a field
 * name: 'how many days of access to give', not 'days'. One message covers both
 * bounds when there are two, because "as a whole number from 1 to 365" tells
 * somebody what to type, while "cannot be more than 365" only tells them they
 * were wrong.
 */
export function requireInt(raw, { field, label = 'a number', min, max } = {}) {
  const n = Number(raw)
  const range =
    min != null && max != null ? ` from ${min} to ${max}`
      : min != null ? ` of ${min} or more`
        : max != null ? ` of ${max} or less`
          : ''
  if (!Number.isInteger(n) || (min != null && n < min) || (max != null && n > max)) {
    fail(`Please enter ${label} as a whole number${range}`, field)
  }
  return n
}

/** One of a list we wrote ourselves; anything else falls back to `fallback`. */
export const oneOf = (raw, allowed, fallback = '') =>
  allowed.includes(raw) ? raw : fallback

/**
 * Cap an array of strings in both directions: how many, and how long each.
 * Used for the admin task lists and tag lists, where the client can post an
 * array of any size.
 */
export const strList = (raw, { max = LIMITS.shortText, count = 50 } = {}) =>
  (Array.isArray(raw) ? raw : []).map((v) => str(v, max)).filter(Boolean).slice(0, count)
