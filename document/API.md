# API Reference

Base URL: `http://localhost:5060/api` (dev). All bodies are JSON.
Auth column: **—** public · **User** = `Authorization: Bearer <user-jwt>` ·
**Admin** = `Authorization: Bearer <admin-jwt>`.

## Health
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | — | `{ ok, service, time }` liveness probe |

---

## User authentication — `/api/user/auth`

| Method | Path | Auth | Rate-limit | Body |
|---|---|---|---|---|
| POST | `/signup` | — | authLimiter | `{ name, email, password, phone? }` |
| POST | `/login` | — | authLimiter | `{ email, password }` |
| POST | `/google` | — | authLimiter | `{ accessToken }` |
| POST | `/verify-email` | — | authLimiter | `{ token }` |
| GET  | `/reset-info?token=` | — | — | query `token` |
| POST | `/reset-password` | — | authLimiter | `{ token, password }` |
| POST | `/forgot-password` | — | emailLimiter | `{ email }` |
| POST | `/resend-verification` | — | emailLimiter | `{ email }` |

**POST /signup** → `201 { ok, email, message }`. Creates an **unverified** account
and emails a verification link. **No token is returned** — the user must verify
before logging in. Errors: `409` email/phone already exists, `400` validation.

**POST /login** → `{ token, user }`. Errors: `401 Invalid email or password`
(same message for unknown email or wrong password — no enumeration);
`403 { error, code: "EMAIL_NOT_VERIFIED" }` if the email isn't verified yet.

**POST /google** → `{ token, user }`. `accessToken` is the Google OAuth access
token from the client (GIS implicit flow). Server verifies its **audience** (must
equal `GOOGLE_CLIENT_ID`) and fetches the profile; links to an existing account by
`googleId` then by email, else creates one (email auto-verified).

**POST /verify-email** → `{ ok, email }`. Consumes the verification token (single
use). Errors `400` invalid/expired. Called by the frontend `/verify-email` page.

**GET /reset-info** → `{ email, name }` for a valid reset token (does **not**
consume it). Lets the reset page show the account email and feed name/email into
the password strength check.

**POST /reset-password** → `{ token, user }` (logs the user straight in). Sets a
new password, marks email verified, clears the purge deadline. `400` invalid/expired.

**POST /forgot-password** / **POST /resend-verification** → always
`{ ok, message }` (generic, even if the email doesn't exist — no enumeration).

---

## User account — `/api/user` (requires User auth)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/profile` | — | `{ user }` |
| PATCH | `/profile` | `{ name?, phone? }` | `{ user }` |
| POST | `/change-password` | `{ currentPassword?, newPassword }` | `{ ok, message }` |

**PATCH /profile** — update name and/or phone. Changing the phone resets
`phoneVerified` to `false`. `409` if the phone belongs to another account.

**POST /change-password** — if a password already exists, `currentPassword` is
required and verified; for Google-only accounts it's a first-time set (no current
needed). Rejects a password containing the user's name/email, or equal to the old.

---

## Blogs — `/api/user/blogs` (public)

The blog archive migrated from the legacy WordPress site (217 posts). All
endpoints are public; only `published` posts are returned.

| Method | Path | Auth | Query | Returns |
|---|---|---|---|---|
| GET | `/` | — | `page`, `limit` (max 50, default 12), `category`, `owner`, `q` | `{ posts, pagination }` |
| GET | `/categories` | — | — | `{ categories: [{ name, count }] }` |
| GET | `/latest` | — | `limit` (default 3, max 12) | `{ posts }` |
| GET | `/:slug` | — | — | `{ post, related }` |

- **`q`** matches title/excerpt case-insensitively (substring, so it works while typing).
- **`owner`** is `svastrino` or `nirmaan` — drives the badge/filter system.
- **`pagination`** is `{ page, limit, total, pages }`.
- **`related`** is up to 3 posts: same category first, then most recent.
- List responses omit `body` to keep a page of cards small; `/:slug` includes it.
- `404` if the slug doesn't exist or the post is unpublished.

**Post object** — list items carry `{ slug, title, owner, author, categories,
excerpt, coverImage, publishedAt, readingMins }`; `/:slug` adds `body`
(markdown) and `sourceUrl` (the original permalink).

---

## Site content — `/api/user/content` (public)

Marketing content migrated from the legacy site. Distinct from the Skill-Build
catalog (`/api/user/skill-build`): these are booked 1-on-1 consultancy programs
with no checkout SKU.

| Method | Path | Auth | Query | Returns |
|---|---|---|---|---|
| GET | `/programs` | — | — | `{ programs }` |
| GET | `/programs/:slug` | — | — | `{ program }` |
| GET | `/faqs` | — | — | `{ faqs: [{ section, items }] }` |
| GET | `/testimonials` | — | `featured=true` | `{ testimonials }` |
| GET | `/career-library` | — | — | `{ fields }` |
| GET | `/courses/:slug` | — | — | `{ course }` |
| GET | `/pages/:slug` | — | — | `{ page }` |
| GET | `/news` | — | `page`, `limit` (max 100, default 30) | `{ news, pagination }` |

- **Programs** — `model-session`, `bulls-eye`, `bloom`, `breakthrough`. The list
  returns cards (`slug, name, tagline, summary, duration, sessions, mode`);
  `/:slug` adds `chooseIf`, `journey` (`[{ label, title, description }]`),
  `benefits` and `brochureUrl`.
- **FAQs** are pre-grouped into ordered sections for the accordion.
- **Career library** streams carry `{ slug, name, description, courseCount,
  courses: [{ name, slug }] }` — 13 streams, 52 distinct courses. A course can
  appear under several streams, so counts sum to more than 52.
- **Course** (`/courses/:slug`) is the detail page: `{ slug, name, overview,
  topQualities: [String], topJobs: [{ role, description, indiaSalary,
  globalSalary }], institutesIndia: [String], institutesInternational:
  [String], careerLadder: [String], fields: [{ name, slug }] }`. `fields` are
  the streams this course belongs to. `404` for an unknown slug.
- **Site pages** (`/pages/:slug`) are the legal/policy pages —
  `terms-of-use`, `privacy-policy`, `cancellations-and-refunds` — as
  `{ slug, title, body (markdown), updatedAt }`. Rendered at `/legal/:slug`.
- **News** (`/news`) is the Quick News archive (253 dated headlines,
  2021–2023) as `{ id, date, text }`, newest first.
- Image fields (`coverImage`, `photo`, `brochureUrl`) are **local paths** like
  `/uploads/content/2025/12/24210-B.jpg` once `npm run fetch:media` has run;
  before that they fall back to the original svastrino.com URLs.

---

## Admin authentication — `/api/admin/auth`

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `/login` | — | `{ email, password }` | `{ token, admin }` |
| GET | `/me` | Admin | — | `{ admin }` |

Admin accounts are created via `npm run seed:admin` (from `SEED_ADMIN_*`), not
through signup.

---

## The `user` object (toUserDTO)
Every user-returning endpoint shapes the document through `toUserDTO` — internal
fields (`passwordHash`, token hashes, `purgeAt`) are never exposed:
```json
{
  "id": "…",
  "name": "Rajnish Yadav",
  "email": "you@example.com",
  "phone": "+919876543210",
  "avatar": "https://…",
  "emailVerified": true,
  "phoneVerified": false,
  "hasPassword": true,
  "isProfileComplete": false
}
```

## Error shape
```json
{ "error": "Human-readable message", "code": "OPTIONAL_MACHINE_CODE" }
```
`code` is present only where the client branches on it (currently
`EMAIL_NOT_VERIFIED`). Status codes: `400` validation, `401` auth,
`403` forbidden/unverified, `404` not found, `409` conflict, `429` rate-limited,
`500` server.
