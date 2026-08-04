# Svastrino Server — Developer Documentation

Backend API for the Svastrino career-mentoring & Skill-Build (Nirmaan) platform.
Express + MongoDB, organised as small **feature modules**.

> New here? Read in this order: **README → ARCHITECTURE → API → DATABASE → AUTH_AND_SECURITY → LEARNING_SYSTEM**.

---

## Tech stack
| Concern | Choice |
|---|---|
| Runtime | Node.js (ESM — `"type": "module"`) |
| Framework | Express 4 |
| Database | MongoDB via Mongoose 8 |
| Auth | JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`) |
| Email | Nodemailer (SMTP) |
| Security | `helmet`, `express-rate-limit`, CORS |
| Google sign-in | Verify Google access token server-side (no client secret) |
| Logging | `morgan` (dev) |
| Config | `dotenv` (loads `.env.local`, falls back to `.env`) |

## Run it
```bash
cd server
npm install
# create .env.local (see "Environment" below)
npm run dev        # node --watch src/index.js  → http://localhost:5060
npm run seed:admin # create the first admin from SEED_ADMIN_* env
npm start          # production start
```
Health check: `GET http://localhost:5060/api/health`

## Environment (`.env.local`)
The loader is `src/config/env.js` (imported FIRST in `index.js`). It reads
`.env.local`, then `.env` as a fallback — never committed (git-ignored).

```
# Server
PORT=5060
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:5174   # CORS allow-list (the frontend origin)
CLIENT_URL=http://localhost:5174      # used to build links inside emails

# Database
MONGODB_URI=mongodb://127.0.0.1:27017/svastrino

# Auth
JWT_SECRET=<random-secret>
JWT_EXPIRES_IN=30d

# Seed admin (npm run seed:admin)
SEED_ADMIN_EMAIL=admin@svastrino.com
SEED_ADMIN_PASSWORD=<password>

# Google sign-in (only the Client ID; must match the client's VITE_GOOGLE_CLIENT_ID)
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com

# Email (SMTP — verification + password-reset links)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=<app-password>              # Gmail: an App Password, not the login
SMTP_FROM=Svastrino <you@gmail.com>
```

## Folder structure
```
server/src/
├── index.js                 # entry — load env, connect DB, start server
├── app.js                   # build the Express app (middleware + routes)
├── config/
│   ├── env.js               # dotenv loader (.env.local / .env) — import first
│   └── db.js                # mongoose connect(MONGODB_URI)
├── routes/index.js          # /api router → /health, /user/*, /admin/*
├── middleware/
│   ├── auth.js              # requireUserAuth / requireAdminAuth (JWT guards)
│   ├── errorHandler.js      # notFound + central error handler
│   └── rateLimit.js         # authLimiter / emailLimiter
├── utils/
│   ├── token.js             # signToken / verifyToken (role-scoped JWT)
│   ├── mailer.js            # nodemailer + branded HTML email builder
│   └── asyncHandler.js      # wraps async controllers → next(err)
├── templates/emails/
│   ├── email-layout.html    # shared HTML email template ({{placeholders}})
│   └── logo.png             # inlined (CID) into emails
└── modules/
    ├── user/                # end-user area  (mounted at /api/user)
    │   ├── index.js
    │   └── credentials/     # auth: model · dto · service · controller · routes
    └── admin/               # admin area     (mounted at /api/admin)
        ├── index.js
        └── credentials/     # admin auth + seedAdmin.js
```

## The module pattern (important)
Every feature is a folder under `modules/<area>/<feature>/` with 5 files that
each have ONE job. See **ARCHITECTURE.md** for the full request lifecycle.

```
credentials.model.js       Mongoose schema (data shape + indexes)
credentials.dto.js         Input validation + output shaping (toDTO)
credentials.service.js     Business logic (DB + rules; throws httpError)
credentials.controller.js  HTTP glue (parse req → call service → send res)
credentials.routes.js      Express routes → middleware + controller
```
Adding a new feature (e.g. `courses`)? Copy this 5-file shape into a new folder
and mount its router in the area's `index.js`. No other wiring needed.
