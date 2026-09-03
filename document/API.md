# API Reference

Base URL: `http://localhost:5060/api` (dev). All bodies are JSON.
Auth column: **—** public · **User** = `Authorization: Bearer <user-jwt>` ·
**Admin** = `Authorization: Bearer <admin-jwt>` · **Org** = the same user JWT,
but the account must own an approved, active Organisation.

There are three areas: `/api/user/*`, `/api/org/*` and `/api/admin/*`.

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

## Partner organisations — `/api/user/organisations` (public)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/` | — | Public directory. Query: `q`, `type`, `state`. Only approved + active + `publicListed` |
| GET | `/filters` | — | `{ types: [{key,label}], states: [] }` for the directory filters |
| GET | `/enrollable` | — | Approved + active — the student enrolment dropdown |
| POST | `/` | — | Partner application. One per IP (`IP_ALREADY_SUBMITTED`), 8/day rate limit |

## Nirmaan Scholarship — `/api/user/scholarship`

Each partner organisation runs its own yearly cycle, so the student's cycle is
always resolved server-side from the organisation they enrolled with — the
client never sends a cycle id.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/winners` | — | Declared winners across every partner, newest first |
| GET | `/me` | User | `{ enrolled, canEnroll, canStart, organisation, student, cycle, attempt, winner, isWinner, history[] }` |
| POST | `/enroll` | User | `{ organisationId, studentClass, section?, rollNo }` → 400 `NO_OPEN_CYCLE`, 409 `ALREADY_ENROLLED` |
| POST | `/attempt/start` | User | `{ attemptId, cycleId, title, instructions, deadline, questions[] }`. Resumes an in-progress attempt; `guidance` is never included |
| POST | `/attempt/submit` | User | `{ answers: [{ question, text }] }` → `{ score, total }` |

---

## Organisation portal — `/api/org` (Org auth)

Every handler is scoped to `req.org`, resolved from the DB on **each** request —
no route accepts an organisation id, so a partner structurally cannot address
another's data. A cycle belonging to someone else returns `404`, never `403`.
Section access is per-organisation (`ORG_MODULES`), so a trimmed module 403s with
`ORG_MODULE_FORBIDDEN`.

| Method | Path | Module | Notes |
|---|---|---|---|
| GET | `/me` | — | `{ organisation, modules, allModules, stats, currentCycle }` |
| PATCH | `/profile` | profile | Public profile fields + `publicListed`. Status/modules/email are ignored |
| GET | `/students` | students | Query `q`, `cycleId`. Includes `activated` (has the student claimed their invite?) |
| POST | `/students` | students | `{ name, email, phone?, class?, section?, rollNo? }` — provisions + enrols + invites |
| POST | `/students/bulk` | students | `multipart/form-data` field `file` (≤2 MB). `?dryRun=1` previews without writing |
| GET | `/students/sample.csv` | students | The import template, `text/csv` |
| DELETE | `/students/:id` | students | Detaches from the organisation; the account itself survives |
| GET · POST | `/scholarship/cycles` | scholarship | List / create (`{ year, title? }`; 409 `CYCLE_EXISTS`) |
| GET · PATCH · DELETE | `/scholarship/cycles/:id` | scholarship | Settings + `status` transitions. Delete only while no attempts exist |
| GET · PUT | `/scholarship/cycles/:id/questions` | scholarship | Replace the whole set; locked once anyone has submitted |
| GET | `/scholarship/cycles/:id/enrollments` | scholarship | |
| DELETE | `/scholarship/enrollments/:id` | scholarship | Clears the enrolment **and** its attempt |
| GET | `/scholarship/cycles/:id/leaderboard` | scholarship | `{ leaderboard[], declaredWinner }` |
| GET | `/scholarship/cycles/:id/attempts/:userId` | scholarship | One answer sheet with per-question marks + AI notes |
| POST | `/scholarship/cycles/:id/winner` | scholarship | `{ userId }` (null clears). Emails every participant, once per change |

**Bulk import** returns the same per-row report whether or not `dryRun` is set,
so the preview never lies:
```json
{ "dryRun": true, "total": 4, "created": 2, "linked": 0, "existing": 0,
  "conflicts": 1, "skipped": 1, "errors": 0, "invitesQueued": 0,
  "results": [{ "line": 2, "name": "…", "email": "…", "status": "created", "message": "…" }] }
```
Row statuses: `created` · `linked` (existing account joined this organisation) ·
`existing` · `conflict` (belongs to another organisation — never stolen) ·
`skipped` (duplicate inside the file) · `error`. CSV columns:
`name, email, phone, class, section, rollNo` — headers are matched loosely
(`Roll No.` = `roll_no` = `rollNo`) and only `email` is mandatory.

---

## Nirmaan Scholarship admin — `/api/admin/scholarship` (module `scholarship`)

Same operations as the portal, but across every partner — the service is simply
called without an organisation scope.

| Method | Path | Notes |
|---|---|---|
| GET | `/overview` | Program-wide counts + the org type/module vocabularies |
| GET | `/organisations` | Query `status`, `type`, `q` |
| GET | `/organisations/:id` | `{ organisation, stats, cycles }` |
| PATCH | `/organisations/:id` | Review: `{ status: 'approved' \| 'rejected', reason? }`. Approving provisions the owner account and emails the set-password link |
| PUT | `/organisations/:id` | Configure: profile, `modules`, `publicListed`, `active` |
| GET | `/organisations/:id/students` | |
| GET | `/cycles` | Every cycle, with live question/enrolment/submission counts. Query `organisation`, `year`, `status` |
| GET · PATCH | `/cycles/:id` | |
| GET · PUT | `/cycles/:id/questions` | |
| GET | `/cycles/:id/enrollments` · `/cycles/:id/leaderboard` · `/cycles/:id/attempts/:userId` | |
| DELETE | `/enrollments/:id` | |
| POST | `/cycles/:id/winner` | |

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
  "isProfileComplete": false,
  "organisationRole": "owner",
  "panel": false,
  "organisation": {
    "id": "…", "name": "Rampur Gram Panchayat", "type": "village",
    "city": "Rampur", "state": "Uttar Pradesh", "code": "RGP-4D04",
    "status": "approved", "portal": true
  }
}
```
`panel` and `organisation` are added by the login / profile controllers (see
`accountFlags`) so the client knows where this account can go. `organisation` is
`null` for a plain signup; `organisation.portal` is true only when the account
**owns** an approved, active organisation — the Navbar uses it so the portal link
never lands on a 403.

## Error shape
```json
{ "error": "Human-readable message", "code": "OPTIONAL_MACHINE_CODE" }
```
`code` is present only where the client branches on it — `EMAIL_NOT_VERIFIED`,
`IP_ALREADY_SUBMITTED`, `NOT_ORG_OWNER`, `ORG_NOT_APPROVED`, `ORG_SUSPENDED`,
`ORG_MODULE_FORBIDDEN`, `NO_OPEN_CYCLE`, `CYCLE_EXISTS`, `ALREADY_ENROLLED`,
`ALREADY_SUBMITTED`, `TEST_CLOSED`, `NOT_ENROLLED`, `OTHER_ORGANISATION`.
Status codes: `400` validation, `401` auth, `403` forbidden/unverified,
`404` not found, `409` conflict, `429` rate-limited, `500` server.
