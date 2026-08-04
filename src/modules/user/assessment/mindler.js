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
 *   'api' (later)
 *     Once Mindler provides real API credentials + endpoint docs, implement the
 *     functions below and set MINDLER_MODE=api. Nothing outside this file needs
 *     to change.
 *
 * NEVER hard-code portal logins here. Anything secret belongs in the env.
 */

export const MINDLER_MODE = process.env.MINDLER_MODE || 'handoff'

// Public white-label sign-up site the student takes the test on.
const STUDENT_URL = process.env.MINDLER_STUDENT_URL || 'https://svastrino.mindler.com/'

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

/**
 * Where to send the student to take the test. In handoff mode this is just the
 * white-label site; in API mode this would be a per-student tokenised link.
 */
export async function testUrlFor(/* user */) {
  if (isApiMode()) throw notConfigured('per-student test links')
  return STUDENT_URL
}

/**
 * Pull a finished result back from Mindler. Handoff mode has no API to call —
 * results are entered by an admin from the partner portal instead.
 * Returns null when there is nothing to sync.
 */
export async function fetchResult(/* externalRef */) {
  if (!isApiMode()) return null
  throw notConfigured('result fetching')
}
