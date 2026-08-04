# Mentoring & Counselling Booking System

Module: `src/modules/user/mentoring/` · mounted at `/api/user/mentoring` (user)
and `/api/admin/mentoring` (admin). Seed: `npm run seed:mentoring`.

## Catalog

ONE parent **SkillBuild** — `{ slug: 'mentoring', name: 'Mentoring',
kind: 'mentoring' }` — is the category; each program is a **Package** under it:

| Program      | Package SKU              | Sessions |
|--------------|--------------------------|----------|
| Bull's Eye   | `mentoring-bullseye`     | 3        |
| Bloom        | `mentoring-bloom`        | 5        |
| Breakthrough | `mentoring-breakthrough` | 22       |

- `SkillBuild.kind = 'mentoring'` keeps the category OUT of the course listings
  (user `listSkillBuilds` and admin content both filter `kind ≠ mentoring`).
- `Package.sessionsCount` / `sessionMins` (120) drive the dashboard tables.
- Prices are placeholders (₹2,999 / ₹4,999 / ₹19,999) — **edit in Admin →
  Packages**; new programs = Admin → Packages → "+ New package" under Mentoring.
- Seed is idempotent and also migrates from the earlier per-program-SkillBuild
  layout (repoints packages, drops the stale builds).

**Payment model:** the program is paid ONCE, on the first booking. IMPORTANT:
`getPackageBySku` derives `product = the package SKU` for mentoring (courses
keep `product = parent slug`) — so each program is an INDEPENDENT product:
buying Bloom after Bull's Eye is a fresh purchase, never an "upgrade" (no
credit, no enrollment supersede, no downgrade block). Every later session of an
owned program books free against its enrollment (`product = sku`).

## Slot engine — `slots.js` (all IST, no DST)

- First bookable day: **today + 3** (spec: 21 Jul → from 24 Jul) · max **2
  months** ahead (`bookingWindow()`).
- Slots are **2 hours**, starts on a **30-min grid**, **9:00 AM–4:00 PM** starts
  (last ends 6 PM).
- **30-min breather** on both sides of every existing booking (2:00 PM end →
  next start 2:30 PM).
- **Sunday**: only slots that END by 1 PM (so last start 11 AM). **Monday**:
  closed.
- Pure core `slotsForDate(dateStr, existing, now)` is unit-testable without a
  DB; `availableSlots(date)` returns `{ date, window, closed, slots:[{start,
  end, startAt}] }`; `isSlotAvailable(date,'HH:MM')` re-validates server-side at
  booking time (race → 409 `SLOT_TAKEN`).
- Known corner: a 9 AM Sunday booking leaves that Sunday with zero further
  slots (11:30 start would end 1:30 PM > cutoff). Correct per rules.

## Booking model — `booking.model.js`

`MentoringBooking { user, programSku, sessionNumber, startAt, endAt,
status: booked|completed|cancelled, update:'', tasks:[], gcalEventId }`.
`update`/`tasks` are the mentor's per-session notes, shown verbatim in the
student dashboard table. `gcalEventId` reserved for the Google Calendar push
(Phase C — needs the owner's Google Cloud OAuth credentials).

## User API

| Route | Auth | Notes |
|---|---|---|
| `GET /programs` | — | catalog with price/sessions/features |
| `GET /slots?date=YYYY-MM-DD` | — | public so the calendar works pre-login |
| `POST /auth/guest` *(credentials module)* | — | guest checkout: `{name,email,phone?}` → creates a verified account with NO password, emails a 7-day set-password link (reset mechanics → `/reset-password` page), returns `{token,user}`. Existing email → 409 `EMAIL_EXISTS` (client shows the login prompt). |
| `GET /my` | 🔐 | dashboard payload: per owned program `sessionsTotal/Booked/Remaining` + full session table rows |
| `POST /bookings` | 🔐 | `{sku,date,start}` — needs an active enrollment; caps at `sessionsCount`; re-validates the slot; `sessionNumber = used+1`; sends a confirmation email (best-effort) |
| `POST /bookings/:id/reschedule` | 🔐 | allowed until **2 days** before `startAt`; re-validates the new slot; sends a reschedule email |

## Admin API — `mentoring.admin.routes.js`

- `GET /api/admin/mentoring/bookings?status=&when=upcoming|past` — all bookings
  with student name/email + program name.
- `PATCH /api/admin/mentoring/bookings/:id` — `{update?, tasks?[], status?}` —
  the mentor's session notes + lifecycle (booked → completed/cancelled).
- `GET /api/admin/mentoring/programs` — catalog for filters.
- Client: **Admin → Mentoring** (`pages/admin/mentoringpage/AdminMentoring.jsx`)
  — filterable table, inline editor (update textarea, tasks one-per-line,
  status).

## Client wizard

`/book-online` (`pages/user/bookonlinepage/BookOnline.jsx`) — see
`client/document/PAGES.md`. Flow: date/slot → details (guest auto-account) →
verify → mock-gateway payment → `POST /bookings`. Free path (owned program or
reschedule) skips payment. `SLOT_TAKEN` after payment returns to the calendar
WITHOUT re-charging (the enrollment is already active).

## Emails (`utils/mailer.js`)

- `buildWelcomeSetPasswordEmail` — guest account welcome + 7-day set-password link.
- `buildBookingEmail` — booking/reschedule confirmation, IST times, dashboard CTA.
- Receipt email comes from the payments stack as usual.

## Phase C — pending

- **Google Calendar one-way push** (booking → owner's Gmail calendar): needs
  the owner's Google Cloud service-account/OAuth creds in `.env.local`
  (`GCAL_*`). Hooks marked `TODO(Phase C)` in `mentoring.service.js`; store
  `gcalEventId`, update it on reschedule.
- Admin-side cancel with slot refund rules, if needed later.
