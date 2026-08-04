# Authentication & Security

## Token model
- Stateless **JWT** (`utils/token.js`). Each token carries a `role` claim
  (`user` | `admin`) so one secret powers both areas without cross-use.
- `requireUserAuth` / `requireAdminAuth` (`middleware/auth.js`) read
  `Authorization: Bearer <jwt>`, verify the signature, and **reject a token whose
  role doesn't match the area**. They attach `req.user = { id }` / `req.admin = { id }`.
- Expiry: `JWT_EXPIRES_IN` (default 30 days). The client stores the token in
  `localStorage` (`svastrino_token` / `svastrino_admin_token`).

## Password auth
- Hashing: **bcrypt, cost 12** (`credentials.service.js`).
- Password policy (identical on client & server — see the client's
  `utils/password.js` and the server DTO `checkPassword`): min 8 chars, a strength
  score ≥ 2 (mix of length/case/digit/symbol), and **must not contain the user's
  name or email**. Enforced on signup, reset, and change-password.
- Login returns a generic `Invalid email or password` for both unknown-email and
  wrong-password (no account enumeration).

## Email verification gate (the core flow)
```
signup  → create UNVERIFIED user, email a 24h link, NO session returned
        → client shows "check your inbox"
click   → /verify-email page POSTs the token → emailVerified=true → redirect to login
login   → blocked with 403 EMAIL_NOT_VERIFIED until verified
```
- Unverified accounts are **auto-deleted after 3 days** via the `purgeAt` TTL
  index (refreshed on each resend), so abandoned signups don't squat on an email.
- Verifying, resetting a password, or signing in with Google all clear `purgeAt`.

## Password reset
`forgot-password` → 1-hour single-use token emailed → `/reset-password` page →
`reset-password` sets the new password and logs the user in. `reset-info` lets the
page show the target email and enforce the "no name/email in password" rule even
though the user isn't logged in. Responses to `forgot-password` are always generic.

## Google sign-in (no client secret)
The client uses Google Identity Services (implicit flow) and sends the **access
token** to `POST /user/auth/google`. The server:
1. Calls Google `tokeninfo` and checks `aud === GOOGLE_CLIENT_ID` (blocks tokens
   minted for a different app).
2. Fetches the profile (`userinfo`); requires a verified Google email.
3. Links by `googleId`, then by email (so a password account and Google unify into
   one account), else creates a new verified account.

## Transport & abuse protection
- **helmet** secure headers; **CORS** restricted to `CLIENT_ORIGIN`.
- **Rate limiting** (`middleware/rateLimit.js`), keyed by IP:
  - `authLimiter` — 20 / 15 min on login, signup, google, reset-password, verify-email.
  - `emailLimiter` — 5 / hour on forgot-password, resend-verification (anti inbox-spam).
- JSON body capped at 100 kb. `trust proxy` set so the real client IP is used.
- One-time tokens stored **hashed** (sha256) with expiry; `passwordHash`,
  `googleId`, and token hashes are `select:false` (never returned by default).

## Secrets & config
- All secrets live in `.env.local` (git-ignored; loaded by `config/env.js`).
- `JWT_SECRET` must be a strong random value in production.
- `GOOGLE_CLIENT_ID` on the server must match `VITE_GOOGLE_CLIENT_ID` on the client.
- SMTP uses an app-password (Gmail), never the account password.

## Known gaps / TODO (flagged in code)
- Admin `AdminProtectedRoute` is a **token-presence** check only — no server-side
  session/profile validation yet.
- `phoneVerified` exists but there is no phone-OTP flow yet.
- No refresh-token rotation (single long-lived JWT).
