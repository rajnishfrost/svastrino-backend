// Repair caption files whose cues run into each other.
//   node src/modules/user/learn/fixCaptionOverlaps.js --dry     (report only)
//   node src/modules/user/learn/fixCaptionOverlaps.js           (write)
//   ... --slug nirmaan   to limit it to one course
//
// The course subtitles came out of a speech-to-text pass that ends each segment
// a few seconds after the next one starts. WebVTT takes that at its word: both
// cues are active, so the player stacks them and the student reads two
// different sentences at once — one of them already spoken. Nothing is wrong
// with the video; only the timings are.
//
// Each repaired track is saved under a NEW storage key and the old file is
// deleted, the same way replacing a caption from the admin panel works. That
// matters on S3: the media CDN caches hard, so rewriting the same key would
// leave students on the old file for as long as a year.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { connectDB } from '../../../config/db.js'
import { Session } from './session.model.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'
import { parseVttCues, removeOverlaps, buildVtt } from '../../../utils/subtitles.js'
import { saveSubtitle, deleteByKey, readStoredText } from '../../../config/uploads.js'

const DRY = process.argv.includes('--dry')
const slugAt = process.argv.indexOf('--slug')
const SLUG = slugAt !== -1 ? process.argv[slugAt + 1] : null

const secs = (t) => {
  const m = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(String(t || '').trim())
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : NaN
}

/** How many cues run into the one after them, and by how much at worst. */
function overlapStats(cues) {
  let count = 0
  let worst = 0
  for (let i = 0; i < cues.length - 1; i++) {
    const gap = secs(cues[i].end) - secs(cues[i + 1].start)
    if (Number.isFinite(gap) && gap > 0.05) { count++; if (gap > worst) worst = gap }
  }
  return { count, worst }
}

async function run() {
  await connectDB()

  const filter = {}
  if (SLUG) {
    const sb = await SkillBuild.findOne({ slug: SLUG })
    if (!sb) { console.error(`✗ No skill-build "${SLUG}"`); process.exit(1) }
    filter.skillBuild = sb._id
  }

  const sessions = await Session.find(filter).sort({ order: 1 })
  console.log(`${DRY ? 'Checking' : 'Repairing'} captions on ${sessions.length} session(s)\n`)

  let looked = 0, fixed = 0, clean = 0, failed = 0
  for (const session of sessions) {
    for (const track of session.captions || []) {
      if (!track.url) continue
      looked++
      const label = `W${String(session.order).padStart(2, '0')} ${track.lang}`
      let vtt
      try {
        // Local in dev, a CDN address in production — readStoredText knows both.
        vtt = await readStoredText(track.url)
      } catch (err) {
        failed++
        console.log(`  ✗ ${label} — could not read it: ${err.message}`)
        continue
      }

      const cues = parseVttCues(vtt)
      const before = overlapStats(cues)
      if (!before.count) { clean++; console.log(`  · ${label} — already clean (${cues.length} cues)`); continue }

      const repaired = removeOverlaps(cues)
      const after = overlapStats(repaired)
      console.log(`  ${DRY ? '?' : '✓'} ${label} — ${before.count}/${cues.length - 1} overlapping (worst ${before.worst.toFixed(1)}s) → ${after.count} left`)
      if (DRY) { fixed++; continue }

      try {
        const saved = await saveSubtitle(buildVtt(repaired))
        const oldKey = track.key
        track.url = saved.url
        track.key = saved.key
        await session.save()
        if (oldKey) await deleteByKey(oldKey).catch(() => {})
        fixed++
      } catch (err) {
        failed++
        console.log(`      ✗ could not save it: ${err.message}`)
      }
    }
  }

  console.log(`\n${looked} track(s) looked at · ${fixed} ${DRY ? 'would be repaired' : 'repaired'} · ${clean} already clean${failed ? ` · ${failed} failed` : ''}`)
  if (DRY && fixed) console.log('Nothing was written. Run it without --dry to repair.')
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Caption repair failed:', err.message)
  process.exit(1)
})
