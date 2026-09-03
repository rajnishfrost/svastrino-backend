// Load the Nirmaan course from the files exported out of Drive.
//   node src/modules/user/learn/ingestNirmaan.js            (everything)
//   node src/modules/user/learn/ingestNirmaan.js --only 1,2 (just those weeks)
//   node src/modules/user/learn/ingestNirmaan.js --dry      (say what it would do)
//
// The course arrives as three separate things that have to be stitched back
// together per week: an .mp4, an .srt, and a row block in a spreadsheet. This
// walks the 24 weeks and, for each, transcodes the video to HLS, stores it and
// the subtitles, and writes one Session carrying the week's title, its rule and
// its six daily tasks.
//
// Deliberately NOT part of seedSkillBuild.js. That script opens with
// Session.deleteMany() and rebuilds from hardcoded URLs — it ran on 19 August
// and wiped a set of uploaded videos. This one only ever upserts the week it is
// working on, so a re-run costs time and nothing else.
//
// Safe to interrupt: a week whose video is already stored is skipped unless
// --force is given, so a run that dies at week 9 can simply be started again.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectDB } from '../../../config/db.js'
import { transcodeToHls, TRANSCODER } from '../../../config/transcoder.js'
import { saveSubtitle, STORAGE } from '../../../config/uploads.js'
import { srtToVtt, parseVttCues, removeOverlaps, buildVtt } from '../../../utils/subtitles.js'
import { titleFor, descriptionFor, worksheetFor } from './nirmaanText.js'
import { Session } from './session.model.js'
import { Question } from './question.model.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'

const here = dirname(fileURLToPath(import.meta.url))
const WEEKS = JSON.parse(readFileSync(join(here, 'data', 'nirmaanWeeks.json'), 'utf8'))

// Where the Drive export was downloaded to. Override with NIRMAAN_SRC.
const SRC = process.env.NIRMAAN_SRC || '/tmp/nirmaan-dl'
const SRT_DIR = join(SRC, 'srt')

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const FORCE = args.includes('--force')
const ONLY = (() => {
  const i = args.indexOf('--only')
  if (i === -1) return null
  return new Set(String(args[i + 1] || '').split(',').map((n) => Number(n.trim())).filter(Boolean))
})()

const pad = (n) => String(n).padStart(2, '0')

/**
 * The week's video and subtitles on disk.
 *
 * Names came off Drive by hand and are not quite uniform — the subtitles are
 * "W_01.srt" but the introduction's is "Introduction.srt" — so each is looked
 * up rather than assumed.
 */
function sourcesFor(week) {
  const video = join(SRC, `W_${pad(week)}.mp4`)
  const srt = join(SRT_DIR, `W_${pad(week)}.srt`)
  return { video, srt, hasVideo: existsSync(video), hasSrt: existsSync(srt) }
}

async function ingestWeek(skillBuildId, w) {
  const { video, srt, hasVideo, hasSrt } = sourcesFor(w.week)
  const label = `W${pad(w.week)}`

  // Skip only what THIS import already put in, recognised by the storage id it
  // writes. Orders 1-10 are the old ten-session course and do carry videos —
  // treating "has a video" as "already done" would leave those ten in place and
  // quietly ingest only weeks 11-24.
  const id = `nirmaan-w${pad(w.week)}`
  const existing = await Session.findOne({ skillBuild: skillBuildId, order: w.week })
  if (existing?.videoUrl?.includes(id) && !FORCE) {
    console.log(`  · ${label} already ingested — skipping (--force to redo)`)
    return { week: w.week, skipped: true }
  }
  if (!hasVideo) {
    console.log(`  ✗ ${label} — no video at ${video}`)
    return { week: w.week, missing: 'video' }
  }

  if (DRY) {
    console.log(`  ? ${label} would ingest: video${hasSrt ? ' + srt' : ' (no srt)'} · ${w.days.length} tasks`)
    return { week: w.week, dry: true }
  }

  // ---- video -------------------------------------------------------------
  process.stdout.write(`  … ${label} transcoding`)
  const t0 = Date.now()
  // transcodeToHls stores the finished folder itself and hands back the master
  // playlist's URL — there is no separate save step.
  const hls = await transcodeToHls(video, id, {
    onProgress: (p) => {
      if (p?.percent != null) process.stdout.write(`\r  … ${label} transcoding ${Math.round(p.percent)}%   `)
    },
  })
  console.log(`\r  … ${label} transcoded in ${((Date.now() - t0) / 60000).toFixed(1)} min → ${hls.masterUrl}`)

  // ---- subtitles ---------------------------------------------------------
  const captions = []
  if (hasSrt) {
    // Same de-overlapping the admin upload does — the course SRTs come from
    // the same speech-to-text pass.
    const vtt = buildVtt(removeOverlaps(parseVttCues(srtToVtt(readFileSync(srt, 'utf8')))))
    const sub = await saveSubtitle(vtt)
    // Spoken in Hindi with English words throughout, which is what the source
    // transcript reads like; labelled the way a student would recognise it.
    captions.push({ lang: 'hi', label: 'Hindi', url: sub.url, key: sub.key || '' })
  }

  // ---- the week itself ---------------------------------------------------
  const doc = {
    skillBuild: skillBuildId,
    order: w.week,
    tier: 1,
    title: titleFor(w),
    description: descriptionFor(w),
    videoUrl: hls.masterUrl,
    durationMins: hls.durationMins || 0,
    captions,
    worksheet: worksheetFor(w),
    active: true,
  }

  const saved = await Session.findOneAndUpdate(
    { skillBuild: skillBuildId, order: w.week },
    { $set: doc },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )

  // The six daily tasks ARE the week's questions — the student answers one a
  // day, and answering the last is what opens the next video. Kept as Questions
  // rather than only as worksheet text so the answers are stored, the progress
  // bar means something, and the Q&A download has something to gather.
  //
  // Replaced wholesale: this week previously carried questions written for a
  // different course, and leaving them would ask about a video no longer here.
  await Question.deleteMany({ session: saved._id })
  if (w.days.length) {
    await Question.insertMany(w.days.map((d) => ({
      session: saved._id,
      skillBuild: skillBuildId,
      order: d.day,
      prompt: d.task,
      placeholder: d.example || '',
      active: true,
    })))
  }
  console.log(`  ✓ ${label} — ${doc.title} · ${captions.length ? 'captions' : 'no captions'} · ${w.days.length} tasks`)
  return { week: w.week, ok: true }
}

async function run() {
  await connectDB()
  const sb = await SkillBuild.findOne({ slug: 'nirmaan' })
  if (!sb) throw new Error('the nirmaan SkillBuild is missing — seed it first')

  // Refuse to run against local disk by accident. The whole point is to put the
  // course where production can reach it; storing 28 GB of HLS on a laptop and
  // writing /uploads/... into the database would leave every video dead in
  // production and the work still to do. --local says you meant it.
  if (STORAGE !== 's3' && !args.includes('--local')) {
    throw new Error(
      'STORAGE is not s3 — the videos would land on this disk, not the bucket.\n'
      + '    source /tmp/nirmaan-env.sh   (STORAGE, S3_BUCKET, AWS_REGION, CDN_URL)\n'
      + '    or pass --local if that is genuinely what you want.',
    )
  }

  // Setting STORAGE=s3 silently switches the transcoder to MediaConvert, which
  // is not built — so every week fails one at a time, several minutes apart,
  // with the same message. Say it once, before any of them start.
  if (TRANSCODER !== 'local') {
    throw new Error(
      `TRANSCODER is "${TRANSCODER}" — it follows STORAGE=s3 by default, and the`
      + ' AWS path is not implemented.\n    export TRANSCODER=local to encode here'
      + ' and store to the bucket, which is what production does too.',
    )
  }

  console.log(`Nirmaan ingest — storage: ${STORAGE} · transcoder: ${TRANSCODER} · source: ${SRC}`)
  const have = existsSync(SRC) ? readdirSync(SRC).filter((f) => f.endsWith('.mp4')).length : 0
  console.log(`  ${have} videos on disk · ${WEEKS.length} weeks in the sheet\n`)

  const results = []
  for (const w of WEEKS) {
    if (ONLY && !ONLY.has(w.week)) continue
    try {
      results.push(await ingestWeek(sb._id, w))
    } catch (err) {
      console.log(`  ✗ W${pad(w.week)} — ${err.message}`)
      results.push({ week: w.week, error: err.message })
    }
  }

  const ok = results.filter((r) => r.ok).length
  const skipped = results.filter((r) => r.skipped).length
  const failed = results.filter((r) => r.error || r.missing)
  console.log(`\n✓ ${ok} ingested · ${skipped} already done`)
  if (failed.length) {
    console.log(`✗ ${failed.length} did not go in:`)
    failed.forEach((f) => console.log(`    W${pad(f.week)} — ${f.error || `missing ${f.missing}`}`))
  }
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Ingest failed:', err.message)
  process.exit(1)
})
