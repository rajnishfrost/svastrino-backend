# Server Architecture

## Boot sequence
```
index.js
 ├─ import './config/env.js'   # loads .env.local / .env into process.env (MUST be first)
 ├─ connectDB()                # config/db.js → mongoose.connect(MONGODB_URI); exits on failure
 └─ createApp().listen(PORT)   # app.js builds the Express app; PORT default 5060
```
`config/env.js` resolves the env file relative to the file itself (not the CWD),
so `npm run dev` and `npm run seed:admin` both find it.

## The Express app (`app.js`)
Middleware order (top to bottom):
1. `app.set('trust proxy', 1)` — real client IP behind a proxy (for rate-limit / `req.ip`).
2. `helmet()` — secure HTTP headers (JSON API, so CSP is left off).
3. `cors({ origin: CLIENT_ORIGIN, credentials: true })` — only the frontend origin.
4. `express.json({ limit: '100kb' })` + `express.urlencoded()` — body parsing (capped).
5. `morgan('dev')` — request logging (skipped when `NODE_ENV=test`).
6. `app.use('/api', routes)` — all API routes.
7. `notFound` → `errorHandler` — 404 then central error handler (always last).

## Routing tree (`routes/index.js`)
```
/api
├── GET /health                     # liveness probe
├── /user   → modules/user/index.js
│   ├── /auth/*                     # signup, login, google, verify, reset, ... (public + limited)
│   ├── GET   /profile              # requireUserAuth
│   ├── PATCH /profile              # requireUserAuth
│   └── POST  /change-password      # requireUserAuth
└── /admin  → modules/admin/index.js
    └── /auth/{login, me}
```

## Request lifecycle (one request end-to-end)
Example: `POST /api/user/auth/login`
```
routes.js         POST /login → [authLimiter] → controller.login
controller.js     validateLogin(req.body)  → DTO returns a clean {email,password}
                  service.login(dto)        → business logic
service.js        find user, bcrypt.compare, checks → returns {token, user}  OR throws httpError
controller.js     res.json({ token, user: toUserDTO(user) })
errorHandler.js   any thrown error (with .status/.code) → JSON { error, code? }
```
The 5 files map 1:1 to responsibilities:

| File | Responsibility | May do |
|---|---|---|
| `*.routes.js` | URL → middleware → controller | attach rate-limiters / auth guards |
| `*.controller.js` | HTTP in/out only | call DTO validators + service, shape response |
| `*.service.js` | business logic & DB | Mongoose queries, bcrypt, tokens, email; `throw httpError` |
| `*.dto.js` | validation + output shaping | reject bad input (`fail()`), `toUserDTO()` |
| `*.model.js` | data shape | Mongoose schema, indexes, field-level `select:false` |

**Rule of thumb:** controllers stay thin; all logic + DB access lives in the service;
never trust `req.body` — always pass it through a DTO validator first.

## Error handling convention
- Services throw a plain `Error` decorated with `.status` (and optional `.code`):
  ```js
  const httpError = (message, status, code) => { const e = new Error(message); e.status = status; if (code) e.code = code; return e }
  throw httpError('Invalid email or password', 401)
  ```
- Controllers are wrapped in `asyncHandler` (`utils/asyncHandler.js`) so a rejected
  promise is forwarded to `next(err)` automatically — no try/catch in controllers.
- `errorHandler.js` sends `{ error: message }` (+ `code` if present, e.g.
  `EMAIL_NOT_VERIFIED`) with the right status. 5xx are logged.

## Middleware
- **`auth.js`** — `requireUserAuth` and `requireAdminAuth`. Both read the
  `Authorization: Bearer <jwt>`, verify it, and check the token's `role` claim
  (`user` vs `admin`). They attach `req.user = { id }` / `req.admin = { id }`.
  A user token cannot access admin routes and vice-versa.
- **`rateLimit.js`** — `authLimiter` (20 req / 15 min: login/signup/google/reset/verify)
  and `emailLimiter` (5 req / hour: forgot-password, resend-verification). Keyed by IP.

## Utilities
- **`token.js`** — `signToken(payload, role)` embeds a `role` claim and signs with
  `JWT_SECRET` (`JWT_EXPIRES_IN`, default 30d). `verifyToken(token)` verifies.
- **`mailer.js`** — lazy nodemailer transport from `SMTP_*`; loads
  `templates/emails/email-layout.html`, fills `{{placeholders}}` (HTML-escaped),
  inlines the logo via CID. Exposes `sendVerificationEmail` / `sendPasswordResetEmail`
  (+ `buildVerificationEmail` / `buildPasswordResetEmail` for tests/previews).
- **`asyncHandler.js`** — `fn => (req,res,next) => Promise.resolve(fn(...)).catch(next)`.

## How to add a feature module
1. `mkdir src/modules/user/courses` (or `admin/...`).
2. Add `courses.model.js`, `courses.dto.js`, `courses.service.js`,
   `courses.controller.js`, `courses.routes.js` (copy the credentials shape).
3. Mount it in `modules/user/index.js`: `router.use('/courses', coursesRoutes)`.
4. Guard private routes with `requireUserAuth`. Done — `/api/user/courses/*` is live.
