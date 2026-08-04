# Learning System — drip schedule, questions, video pipeline

How a purchased Skill-Build course is actually delivered: one video per week,
six daily questions per video, everything unlocking on an IST-midnight clock.

## The drip rule (one rule, chained)

> **Every action unlocks the next item at 00:00 IST of the following day.**

```
Start (consent)          → Video 1 opens IMMEDIATELY
Video N watched to 90%   → Q1 opens next IST-midnight
Q1 answered              → Q2 opens next IST-midnight
… (6 questions)
Q6 answered              → session complete → Video N+1 opens next IST-midnight
```
Ideal pace = 1 video + 6 questions = **7 days per session** (the "one video a week").
A missed day just shifts the chain — no penalty, but the report records the delay.

Time maths live in `src/utils/schedule.js` (`nextIstMidnight`, `istDaysBetween`;
IST is fixed UTC+5:30, no DST, so plain offset arithmetic).

## Models (`src/modules/user/learn/`)

| Model | One row per | Key fields |
|---|---|---|
| `Session` | lesson | order, tier (min package rank), videoUrl, durationMins, worksheet, **notes[{time,text}]** |
| `Question` | session × order (1..6) | prompt (free-text answer, not graded) |
| `Answer` | user × question | text, submittedAt (drives the next unlock) |
| `Progress` | user × session | **videoDoneAt** (first 90% watch → Q1 anchor + seek unlock), **completed/At** (all 6 answered → next-video anchor) |
| `LearnState` | user × skillBuild | **startedAt** — set by the Start button (consent); anchor for the whole schedule + report |

## Endpoints (`/api/user/learn`, all auth)

| Route | Does |
|---|---|
| `GET /:slug` | Full gated course: per-session `videoLocked/videoUnlockAt/videoDone/completed` + per-session question state (`current`, `nextUnlockAt`, `answered[]` — future prompts are never sent) |
| `POST /:slug/start` | Begin the course (idempotent). Needs to be online — response builds the UI and starts the upgrade window |
| `POST /sessions/:id/video-done` | First 90% watch (kept once; re-watches don't move the anchor). Idempotent → safe for the client's offline replay queue |
| `POST /questions/:id/answer` | Stores the text answer; rejects anything but the CURRENT open question (`LOCKED`); 6th answer marks the session complete |
| `GET /:slug/report` | `targetDays = sessions × 7` (auto), daysElapsed, actualDays when finished, onTrack |

Gating is enforced **server-side** in `learn.service.js` (`computeQuestions`,
`videoUnlockAtFor`) — the client can't skip ahead by calling endpoints directly.

## Video pipeline (admin upload)

```
admin upload (multipart + ?uploadId=…)
  → multer stages to uploads/tmp
  → transcoder.js: ffmpeg → adaptive HLS ladder 144p…2160p (never upscales),
    live % via `-progress` reported to GET /api/admin/upload/progress/:id
  → uploads.js saveHlsDir → /uploads/hls/<id>/master.m3u8
  → fallback: if transcode fails, raw MP4 is kept (saveVideo)
```
- Ladder: 144/240/360/480/720/1080/1440/2160 — a rung is produced only if the
  source is at least that tall. Old uploads need a re-upload to gain new rungs.
- **Swappable adapters** (same pattern as the payment gateway): `transcoder.js`
  `local|aws` (MediaConvert stub) and `uploads.js` `local|s3` (S3/CloudFront stub).
  DRM/offline-encryption for production is planned in `VIDEO_DRM_OFFLINE_PLAN.md`.

## Admin content tools
- Sessions CRUD + per-session **Questions** editor (up to 6 prompts, `PUT /api/admin/sessions/:id/questions`).
- Timestamped **video notes** are part of the session body (`notes`), edited as `M:SS text` lines.

## Dev scripts
```
npm run seed:questions            # 6 questions for every session
npm run reset:progress [slug]     # wipe everyone's progress/answers/start
npm run reset:user -- <email> [slug]   # wipe ONE student (Start button returns)
```
