/**
 * What state is this account in? One answer, used everywhere it is shown.
 *
 * It existed twice before, and the two disagreed. The organisation's roster
 * asked "does this student have a password yet?" and showed "Invite sent" when
 * they did not; the admin panel showed whether the EMAIL was verified. So a
 * student an organisation had provisioned read as "Invite sent" on one screen
 * and a verified, ordinary account on the other — two screens describing the
 * same person differently, and neither of them wrong on its own terms.
 *
 *   'disabled' — switched off by an admin, or detached from the organisation
 *                that created them. Cannot sign in.
 *   'invited'  — the account exists but nobody has claimed it: no password, no
 *                Google. An organisation (or an admin) made it and the link is
 *                still sitting in an inbox.
 *   'active'   — there is a way to sign in and nothing is blocking it.
 *
 * `googleId` matters here and is the thing the old roster check missed: a
 * student who took their invite and then signed in with Google has no password
 * for ever, and the roster would have called them "Invite sent" for ever too.
 *
 * Pass a document that actually selected `passwordHash` and `googleId` — both
 * are `select: false`, so a lean projection will report a live account as
 * invited. `usersWithAuthFields` below is the query that gets it right.
 */
export function accountStatus(user) {
  if (!user) return 'disabled'
  if (user.active === false) return 'disabled'
  if (user.passwordHash || user.googleId) return 'active'
  return 'invited'
}

/** The extra fields accountStatus needs, for `.select()`. */
export const AUTH_STATUS_FIELDS = '+passwordHash +googleId'

/**
 * Where an account came from, in words, for a panel that has already resolved
 * the organisation. A student who signed themselves up belongs to no
 * organisation, and "—" would read as missing data rather than as the answer,
 * so it is named.
 */
export function organisationLabel(user, orgName) {
  if (orgName) return orgName
  return user?.organisation ? 'Organisation' : 'Self'
}
