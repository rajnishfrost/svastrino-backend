/**
 * Mindler provider adapter for the psychometric assessment.
 *
 * Two modes, chosen by MINDLER_MODE (same pattern as payments/gateway.js):
 *
 *   'handoff' (default, works today)
 *     We only have the Mindler *partner portal* + a white-label student site.
 *     The student is sent to that site to register and take the test; we track
 *     the status on our side and an admin attaches the finished report.
 *
 *   'api'
 *     Mindler's GRAFT token login (API guide, 2026-09-22). Our server asks
 *     Mindler for a login token carrying the student's name, email, phone and
 *     test type; the student is then sent to
 *     <MINDLER_ORIGIN>/loginWithToken/<token>, which signs them up if needed,
 *     logs them in and opens the assessment. One call does both — the guide has
 *     no separate sign-up endpoint.
 *
 *     Needs MINDLER_CLIENT_CODE. MINDLER_ORIGIN and MINDLER_API_BASE default
 *     to the values in the guide.
 *
 * NEVER hard-code portal logins here. Anything secret belongs in the env.
 *
 * Not in the API yet, so still manual in both modes: knowing when a student has
 * finished, and fetching the report. See fetchResult below.
 */

import { parseStudentClass } from '../../../utils/studentClass.js'

export const MINDLER_MODE = process.env.MINDLER_MODE || 'handoff'

// GRAFT token login. The origin is both the Origin header the API expects and
// the host the student is sent to — the guide uses the same value for each.
const API_BASE = (process.env.MINDLER_API_BASE || 'https://apis.mindler.com').replace(/\/+$/, '')
const ORIGIN = (process.env.MINDLER_ORIGIN || 'https://assessment.svastrino.com').replace(/\/+$/, '')
const CLIENT_CODE = process.env.MINDLER_CLIENT_CODE || ''
// The student is watching a loader while this runs, so give up well before
// they would; a retry is one click.
const API_TIMEOUT_MS = 15000

// Public white-label site the student takes the test on. It is our own domain
// now — Mindler serves the platform at assessment.svastrino.com (live over
// HTTPS since 2026-09-18) — so it defaults to the same host as the token login
// rather than to the old svastrino.mindler.com, which is no longer ours to send
// students to.
const STUDENT_URL = process.env.MINDLER_STUDENT_URL || `${ORIGIN}/`

// Partner-provisioned access code students enter when signing up on the site,
// plus the sign-up steps shown to them. Env-backed so nothing is hard-coded;
// steps can be overridden with a `|`-separated MINDLER_SIGNUP_STEPS.
const ACCESS_CODE = process.env.MINDLER_ACCESS_CODE || ''
// Matches the actual sign-up form on the white-label site (Sign Up tab asks
// name / email / password and has a "Coupon Code" field for our partner code).
const DEFAULT_STEPS = [
  'Open the test site and use the Sign Up tab — enter your name and the SAME email you use here.',
  'Put your coupon code (below) in the “Coupon Code” field, then create your account.',
  'Complete the Psychometric Assessment (interest, aptitude, personality, EQ & orientation).',
  'Come back here and tap “I’ve finished it”.',
]
const SIGNUP_STEPS = (process.env.MINDLER_SIGNUP_STEPS || '')
  .split('|')
  .map((s) => s.trim())
  .filter(Boolean)

export const isApiMode = () => MINDLER_MODE === 'api'

/** Static handoff details for the student card (test URL, access code, steps). */
export function handoffInfo() {
  return {
    testUrl: STUDENT_URL,
    accessCode: ACCESS_CODE || null,
    steps: SIGNUP_STEPS.length ? SIGNUP_STEPS : DEFAULT_STEPS,
  }
}

const notConfigured = (what) => {
  const err = new Error(
    `Mindler API mode is on but ${what} is not implemented yet. ` +
      'Add the endpoint + credentials from Mindler, then implement this in mindler.js.'
  )
  err.status = 501
  return err
}

const httpError = (message, status, code) => {
  const err = new Error(message)
  err.status = status
  if (code) err.code = code
  return err
}

// Mindler's two assessments. Stream is for students still choosing between
// Science, Commerce and Humanities; Career is for those past that choice.
const USER_TYPE = { stream: 1, career: 2 }

/**
 * Which Mindler test a class sits: 7 to 9 take Stream, 10 to 12 take Career —
 * the split the psychometric page sells them under. Null outside 7 to 12;
 * checkout never sells a psychometric plan there, so that means the profile
 * was changed after buying.
 */
export function userTypeFor(studentClass) {
  const n = parseStudentClass(studentClass)
  if (n >= 7 && n <= 9) return USER_TYPE.stream
  if (n >= 10 && n <= 12) return USER_TYPE.career
  return null
}

/**
 * A phone the way the guide's example writes it: a plain 10-digit number for
 * India, since it shows '9998989080'. We store E.164 ('+919998989080'), so
 * Indian numbers drop the 91 and anything else keeps its country code as digits.
 * Nothing is sent when there is no phone — the API only requires the email.
 */
function mindlerPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return undefined
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  return digits
}

/** 'Asha Rani Verma' → first 'Asha', last 'Rani Verma'. */
function splitName(name, email) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  // An account can exist without a name; Mindler still wants a first name, and
  // the part of the email before the @ is what the student will recognise.
  if (!parts.length) return { first: String(email || '').split('@')[0] || 'Student', last: undefined }
  return { first: parts[0], last: parts.length > 1 ? parts.slice(1).join(' ') : undefined }
}

/**
 * Ask Mindler for this student's login token. Throws a 502 the student can
 * act on ("try again") when Mindler fails; the reason goes to the log only.
 * The token itself is a login credential and is never logged.
 */
async function generateAuthToken(user) {
  if (!CLIENT_CODE) {
    throw httpError(
      'The psychometric test is not set up yet. Please try again later.',
      503,
      'MINDLER_NOT_CONFIGURED'
    )
  }

  const userType = userTypeFor(user.studentClass)
  if (!userType) {
    throw httpError(
      'We need to know which class you are in (7 to 12) to open the right test. Please add your class in Settings, then try again.',
      400,
      'CLASS_REQUIRED'
    )
  }

  const { first, last } = splitName(user.name, user.email)
  const body = {
    client_code: CLIENT_CODE,
    user_type: userType,
    email: user.email,
    first_name: first,
    // The guide spells this one 'Last_name' in the request and 'last_name' in
    // the response. Sent as the request example has it until Mindler confirms.
    ...(last ? { Last_name: last } : {}),
    ...(mindlerPhone(user.phone) ? { phone: mindlerPhone(user.phone) } : {}),
  }

  let res
  try {
    res = await fetch(`${API_BASE}/api/graftAuth/v1/generateAuthToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })
  } catch (err) {
    console.error(`✗ Mindler generateAuthToken unreachable for ${user.email}:`, err.name === 'TimeoutError' ? `timed out after ${API_TIMEOUT_MS}ms` : err.message)
    throw httpError('The test site is not responding right now. Please try again in a minute.', 502, 'MINDLER_UNAVAILABLE')
  }

  const data = await res.json().catch(() => null)
  const token = data?.data?.token
  if (!res.ok || !data?.success || !token) {
    // Mindler answers a bad request with { errors: [{ field, message }] }.
    const why = data?.message || (data?.errors || []).map((e) => `${e.field}: ${e.message}`).join(', ') || `HTTP ${res.status}`
    console.error(`✗ Mindler generateAuthToken refused for ${user.email}: ${why}`)
    throw httpError('We could not open your test just now. Please try again in a minute.', 502, 'MINDLER_REFUSED')
  }
  return token
}

/**
 * Where to send the student to take the test. In handoff mode, the white-label
 * site, where they sign up themselves. In API mode, a one-time login link that
 * lands them in the assessment already signed in.
 *
 * `user` needs name, email, phone and studentClass.
 */
export async function testUrlFor(user) {
  if (!isApiMode()) return STUDENT_URL
  const token = await generateAuthToken(user)
  return `${ORIGIN}/loginWithToken/${encodeURIComponent(token)}`
}

/**
 * Pull a finished result back from Mindler. There is no endpoint for this in
 * either mode yet — the GRAFT guide covers login only — so results are still
 * entered by an admin from the partner portal. Returns null when there is
 * nothing to sync.
 */
export async function fetchResult(/* externalRef */) {
  if (!isApiMode()) return null
  throw notConfigured('result fetching')
}
