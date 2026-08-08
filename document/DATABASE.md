# Database & Models

MongoDB via Mongoose. Accounts live in **users** and **admins**; the Skill-Build
catalog in `skillbuilds` / `packages` / `sessions`; commerce in `orders` /
`enrollments` / `coupons`; and the content migrated from the legacy site in
`blogs`, `mentoringprograms`, `faqs`, `testimonials` and `careerfields`
(documented at the bottom of this file).
The Nirmaan scholarship lives in `organisations`, `scholarshipcycles`,
`scholarshipquestions`, `scholarshipenrollments` and `scholarshipattempts`
(documented below).

## User — `modules/user/credentials/credentials.model.js`
One unified account powers both Mentoring and Skill-Build.

| Field | Type | Notes |
|---|---|---|
| `name` | String | trimmed |
| `email` | String | **required, unique, lowercase** — the login identity |
| `phone` | String | sparse, unique (optional) |
| `passwordHash` | String | `select:false` — bcrypt; absent for Google-only accounts |
| `googleId` | String | `select:false`, sparse, unique — Google account link |
| `avatar` | String | Google photo URL (if any) |
| `emailVerified` | Boolean | default `false`; login is gated on this |
| `phoneVerified` | Boolean | default `false`; reserved for a future phone-OTP flow |
| `emailVerifyTokenHash` | String | `select:false` — sha256 of the raw link token |
| `emailVerifyExpires` | Date | `select:false` — 24 h |
| `passwordResetTokenHash` | String | `select:false` — sha256 |
| `passwordResetExpires` | Date | `select:false` — 1 h |
| `purgeAt` | Date | `select:false` — **TTL**: unverified accounts auto-delete |
| `isProfileComplete` | Boolean | default `false` |
| `organisation` | ObjectId → Organisation | `null` when nobody added them (a plain public signup) |
| `organisationRole` | String | `'member'` (a student their organisation added) · `'owner'` (this account **is** the organisation) · `null` |
| `lastLoginAt` | Date | |
| `createdAt` / `updatedAt` | Date | `timestamps: true` |

`organisation` + `organisationRole` answer "where did this account come from?".
An owner is what `requireOrgAuth` looks for — it is the only way into
`/api/org/*`. See **Organisation** below.

**Indexes**
- `email` unique, `phone` unique+sparse, `googleId` unique+sparse.
- **TTL:** `schema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 })` — MongoDB
  deletes a doc once `purgeAt` is in the past. Docs *without* `purgeAt` (verified
  users) are never auto-deleted.

**`select:false` fields** (`passwordHash`, `googleId`, token hashes, `purgeAt`)
are excluded from queries by default. Services opt in explicitly, e.g.
`User.findById(id).select('+passwordHash')`. This is why `findUserById` selects
`+passwordHash` — so `toUserDTO` can report `hasPassword` correctly.

### Lifecycle of the security fields
| Event | Effect |
|---|---|
| signup | set `emailVerifyTokenHash/Expires` + `purgeAt` (now + 3 days) |
| resend-verification | re-issue token + push `purgeAt` out again |
| verify-email | `emailVerified=true`; clear verify token + **clear `purgeAt`** |
| forgot-password | set `passwordResetTokenHash/Expires` (now + 1 h) |
| reset-password | new `passwordHash`; clear reset token; `emailVerified=true`; clear `purgeAt` |
| google sign-in | link `googleId`; `emailVerified=true`; clear `purgeAt` |
| change phone (PATCH /profile) | `phoneVerified=false` |

## Admin — `modules/admin/credentials/credentials.model.js`
Separate from end-users.

| Field | Type | Notes |
|---|---|---|
| `name` | String | default `'Admin'` |
| `email` | String | required, unique, lowercase |
| `passwordHash` | String | required — bcrypt |
| `role` | String | enum `admin | superadmin`, default `admin` |
| `lastLoginAt` | Date | |
| `createdAt` / `updatedAt` | Date | timestamps |

Seed the first admin: `npm run seed:admin` (reads `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD`; script at `modules/admin/credentials/seedAdmin.js`).

## Nirmaan Scholarship

The scholarship is **organisation-scoped and yearly**. A partner organisation
runs its own cycle each year — its own questions, its own window, its own
leaderboard, its own winner. Nothing is global.

```
Organisation ──< ScholarshipCycle  (one per {organisation, year})
                      ├──< ScholarshipQuestion
                      ├──< ScholarshipEnrollment  ──> User
                      └──< ScholarshipAttempt     ──> User
```

### Organisation — `modules/user/organisation/organisation.model.js`
Any body we tie up with: a school, college, village panchayat, NGO, coaching
centre or company. Supersedes the old `Institution` (school/college only, no
login).

| Field | Type | Notes |
|---|---|---|
| `name` | String | required |
| `type` | String | enum `school · college · village · ngo · coaching · corporate · other` |
| `description` | String | public blurb shown in the directory (≤1200 chars) |
| `branch` `address` `city` `state` `pincode` `website` | String | optional profile |
| `contactPerson` `phone` `email` | String | `email` is required and becomes the owner's login |
| `code` | String | unique+sparse — short handle (e.g. `DPS-4F2A`) assigned on approval |
| `status` | String | enum `pending · approved · rejected` |
| `rejectionReason` | String | emailed to the applicant |
| `owner` | ObjectId → User | the organisation's login account; created **on approval** |
| `modules` | [String] | which portal sections admin granted: `students`, `scholarship`, `profile` |
| `publicListed` | Boolean | opt out to disappear from `/organisations` (still enrollable) |
| `active` | Boolean | suspend without deleting — blocks the portal and hides it from enrolment |
| `submittedIp` | String | one public application per IP |
| `reviewedBy` / `reviewedAt` | | audit of the approve/reject |

**Lifecycle:** public form → `pending` → admin approves → a `code` is assigned,
an owner `User` is created (role `organisation`, `organisationRole: 'owner'`) and
emailed a 7-day set-password link to the portal. If the contact email already has
an account, it is *promoted* rather than duplicated.

### ScholarshipCycle — `modules/user/scholarship/scholarship.model.js`
| Field | Type | Notes |
|---|---|---|
| `organisation` | ObjectId → Organisation | required |
| `year` | Number | required — **unique together with `organisation`** |
| `title` `instructions` | String | shown to students on the test paper |
| `startAt` / `endAt` | Date | the test window |
| `durationMins` | Number | per-student limit once they start (default 30) |
| `status` | String | `draft` (invisible to students) · `published` (live) · `archived` (read-only history) |
| `active` | Boolean | pause inside `published` without unpublishing |
| `declaredWinner` | ObjectId → User | must have submitted **this** cycle |
| `winnerDeclaredAt` | Date | |

Publishing is refused unless the cycle has ≥1 question and both window dates.
Once any student submits, the questions lock — a score can never shift under a
student who already answered.

### ScholarshipQuestion / Enrollment / Attempt
All three carry `cycle`; enrolments and attempts also denormalise
`organisation` so "everything this partner has ever run" is one indexed query.

- **Question** — `order`, `prompt`, `guidance` (internal AI grading hint, *never*
  sent to students), `maxWords` (20–1000).
- **Enrollment** — `studentClass`, `section`, `rollNo`, `source`
  (`self` | `bulk` | `org`). Unique on `{user, cycle}` — one entry per year, so a
  student can return next year.
- **Attempt** — `answers[]` (`question`, `text`, `awarded` 0/1, AI `feedback`),
  `score`, `total`, `gradedModel`, `status`. Unique on `{user, cycle}`.

**Indexes**
- `{organisation, year}` unique on cycles. The create path *also* checks
  explicitly first: Mongoose builds indexes in the background, so on a fresh
  database the index alone would let a duplicate through.
- `{user, cycle}` unique on enrolments and attempts.
- `{cycle, status, score:-1, submittedAt:1}` — the leaderboard sort.
- `{status, active, publicListed}` on organisations — the directory + enrolment
  dropdown both ask for exactly this.

### Migrating from the old shape
`npm run migrate:organisations` copies `institutions` → `organisations`
(**keeping `_id`**, so every existing reference stays valid) and turns the
singleton `scholarshiptests` doc into one cycle per organisation for the current
year, cloning the global questions into each. Idempotent — `cycle` is the
discriminator that tells migrated docs from legacy ones, so re-running is a
no-op. The legacy collections are left in place; drop them by hand once the new
data checks out.

## Migrated site content

Content lifted from the legacy WordPress site at svastrino.com. All of it is
public and read-only over the API; reseeding is idempotent.

### Blog — `modules/user/blogs/blog.model.js`
217 posts. Seed with `npm run seed:blogs` (upserts by `slug` from
`modules/user/blogs/data/blogs.json`).

| Field | Type | Notes |
|---|---|---|
| `slug` | String | **required, unique** — the URL segment, kept from WordPress |
| `title` | String | required |
| `owner` | String | enum `svastrino \| nirmaan`, default `svastrino` — badge/filter |
| `author` | String | default `'Svastrino'` |
| `categories` | [String] | indexed; 8 distinct values across the archive |
| `excerpt` | String | derived at seed time from the first real paragraph of `body` |
| `body` | String | **markdown**, rendered client-side |
| `coverImage` | String | absolute URL (still served from svastrino.com) |
| `sourceUrl` | String | original permalink — keeps the import traceable |
| `publishedAt` | Date | indexed; listing sorts on it descending |
| `readingMins` | Number | computed at seed time (200 wpm) |
| `published` | Boolean | default `true`; only `true` is served |
| `order` | Number | position in the original listing (1 = newest) |

A text index on `title/excerpt/body` exists, but list search uses a case-insensitive
regex on title/excerpt so partial words match while the user is still typing.

### MentoringProgram — `modules/user/content/program.model.js`
The four consultancy programs. Deliberately separate from `SkillBuild`/`Package`
— those are self-serve priced courses, these are booked sessions with no SKU.

| Field | Type | Notes |
|---|---|---|
| `slug` | String | required, unique — `model-session`, `bulls-eye`, `bloom`, `breakthrough` |
| `name` / `tagline` / `summary` | String | |
| `duration` / `sessions` / `mode` | String | display strings, e.g. `'45–60 days'` |
| `chooseIf` | [String] | "choose this program if…" bullets |
| `journey` | [{ label, title, description }] | stage-by-stage breakdown (`_id: false`) |
| `benefits` | [String] | |
| `brochureUrl` / `sourceUrl` | String | |
| `order` / `active` | Number / Boolean | |

### Faq · Testimonial · CareerField — `modules/user/content/`
Seeded together by `npm run seed:content`. Programs and career fields upsert by
`slug`; FAQs and testimonials have no natural key, so the seed replaces those two
collections wholesale to avoid accumulating duplicates on reruns.

| Model | Key fields |
|---|---|
| `Faq` | `section` (indexed), `question`, `answer`, `order`, `active` |
| `Testimonial` | `name`, `role`, `quote`, `photo`, `program`, `featured`, `order`, `active` |
| `CareerField` | `slug`, `name`, `description`, `courses: [{ name, slug }]`, `order`, `active` |

**Career library** — 13 streams / 52 distinct courses, sourced from the legacy
site's own WordPress REST API (`/wp-json/wp/v2/posts?categories=…`) so the
stream→course mapping is exact. Courses are many-to-many: several sit in more
than one stream (Interior Design is both Arts and Commercial Arts), which is why
the 13 streams hold 80 course links across 52 unique courses. Data lives in
`modules/user/content/data/career-library.json`.

### Course — `modules/user/content/course.model.js`
The 52 course **detail** pages, scraped from svastrino.com/<slug>/ into
`data/courses/<slug>.json` (one file per course). Keyed by `slug` — one document
even when a course sits in several streams.

| Field | Type | Notes |
|---|---|---|
| `slug` | String | required, unique — matches `CareerField.courses[].slug` |
| `name` | String | required |
| `overview` | String | 2–4 sentence field description |
| `topQualities` | [String] | skills/qualities the field needs |
| `topJobs` | [{ role, description, indiaSalary, globalSalary }] | salary strings verbatim from the page |
| `institutesIndia` / `institutesInternational` | [String] | top institutes |
| `careerLadder` | [String] | ordered progression steps |
| `fields` | [{ name, slug }] | streams this course belongs to, denormalised from the career library at seed time |
| `sourceUrl` | String | original course page |

Seeded by `npm run seed:content` (upsert by `slug`) alongside the career library,
so the `fields` back-reference always matches the current stream mapping.

### SitePage · NewsItem — `modules/user/content/`
Also seeded by `npm run seed:content`:

| Model | Contents | Key fields |
|---|---|---|
| `SitePage` | the 3 legal pages (Terms of Use, Privacy Policy, Cancellations & Refunds), from `data/pages/<slug>.json` | `slug` (unique), `title`, `body` (markdown), `sourceUrl`, `active` |
| `NewsItem` | the Quick News archive — 253 dated headlines (May 2021 – Oct 2023) from `data/news.json`; replaced wholesale on reseed (no natural key) | `date` (indexed), `text`, `order`, `active` |

Two privacy-policy passages were adapted during migration rather than copied
verbatim: the "hosted on Wix.com" paragraph was dropped (no longer true of this
MERN build) and the contact address was updated from the legacy Gmail to
contact@svastrino.com. Everything else is verbatim from the legacy site.

## Media

Migrated images are **not** hot-linked from svastrino.com. `npm run fetch:media`
downloads every referenced asset into `uploads/content/<year>/<month>/…` (served
at `/uploads/content/…`) and writes `src/data/media-manifest.json` mapping the
original URL → the local path. The seeds call `utils/media.js#localMedia()`,
which uses that manifest and **falls back to the remote URL when the fetch
hasn't been run**, so seeding always produces a working site.

Images are re-encoded to JPEG (max 1200px, quality `high`) via `sips`: the
originals are ~950 KB 1080px PNGs displayed at ~370 CSS px, so the full set drops
from **222 MB to 49 MB**. `uploads/` is gitignored — the fetch is a repeatable
setup step, not a committed asset bundle. Re-run with `-- --force` to refresh.

## Token storage — why hashes, not raw tokens
Email-verification and password-reset **raw** tokens exist only inside the emailed
link. The DB stores only their **sha256 hash** + an expiry. On use, the server
hashes the incoming token and looks up the match. A database leak therefore can't
be replayed into a working link. All such tokens are single-use and time-boxed.
