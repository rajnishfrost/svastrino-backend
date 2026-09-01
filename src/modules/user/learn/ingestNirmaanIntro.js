// Put the Nirmaan introduction in front of the 24 weeks.
//   node src/modules/user/learn/ingestNirmaanIntro.js
//   node src/modules/user/learn/ingestNirmaanIntro.js --dry
//
// The introduction is not one of the weeks: it has no tasks, it is not in the
// course sheet, and it does not belong to a phase. It sits at order 0 so the
// weeks keep the numbering the course is written around — week 1 is session 1,
// and the six-phases-of-four arithmetic still works.
//
// Having no tasks is the point. A student watches it, and the first real week
// opens straight away rather than at the next midnight — the midnight wait
// exists to pace six days of daily tasks, and the introduction has none. That
// is handled in learn.service (videoUnlockAtFor), not here.
import '../../../config/env.js'
import mongoose from 'mongoose'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { connectDB } from '../../../config/db.js'
import { transcodeToHls, TRANSCODER } from '../../../config/transcoder.js'
import { saveSubtitle, STORAGE } from '../../../config/uploads.js'
import { srtToVtt } from '../../../utils/subtitles.js'
import { Session } from './session.model.js'
import { Question } from './question.model.js'
import { SkillBuild } from '../skillbuild/skillbuild.model.js'

const SRC = process.env.NIRMAAN_SRC || '/tmp/nirmaan-dl'
const VIDEO = join(SRC, 'Nirmaan_Intro.mp4')
const SRT = join(SRC, 'srt', 'Introduction.srt')
const ID = 'nirmaan-intro'
const DRY = process.argv.includes('--dry')
const FORCE = process.argv.includes('--force')

async function run() {
  await connectDB()

  if (STORAGE !== 's3') {
    throw new Error('STORAGE is not s3 — source /tmp/nirmaan-env.sh first')
  }
  if (TRANSCODER !== 'local') {
    throw new Error(`TRANSCODER is "${TRANSCODER}" — export TRANSCODER=local`)
  }

  const sb = await SkillBuild.findOne({ slug: 'nirmaan' })
  if (!sb) throw new Error('the nirmaan SkillBuild is missing')
  if (!existsSync(VIDEO)) throw new Error(`no video at ${VIDEO}`)

  const existing = await Session.findOne({ skillBuild: sb._id, order: 0 })
  if (existing?.videoUrl?.includes(ID) && !FORCE) {
    console.log('  · introduction already in — nothing to do (--force to redo)')
    await mongoose.disconnect()
    return
  }

  if (DRY) {
    console.log(`  ? would ingest ${VIDEO}${existsSync(SRT) ? ' + Introduction.srt' : ' (no srt)'} at order 0`)
    await mongoose.disconnect()
    return
  }

  console.log('  … transcoding the introduction')
  const t0 = Date.now()
  const hls = await transcodeToHls(VIDEO, ID, {
    onProgress: (p) => {
      if (p?.percent != null) process.stdout.write(`\r  … transcoding ${Math.round(p.percent)}%   `)
    },
  })
  console.log(`\r  … done in ${((Date.now() - t0) / 60000).toFixed(1)} min → ${hls.masterUrl}`)

  const captions = []
  if (existsSync(SRT)) {
    const sub = await saveSubtitle(srtToVtt(readFileSync(SRT, 'utf8')))
    captions.push({ lang: 'hi', label: 'Hindi', url: sub.url, key: sub.key || '' })
  }

  const saved = await Session.findOneAndUpdate(
    { skillBuild: sb._id, order: 0 },
    {
      $set: {
        skillBuild: sb._id,
        order: 0,
        tier: 1,
        title: 'Introduction to Nirmaan',
        description: 'What the next 24 weeks look like, and how to get the most out of them. No tasks — the first week opens as soon as you finish this.',
        videoUrl: hls.masterUrl,
        durationMins: hls.durationMins || 0,
        captions,
        worksheet: { title: '', tasks: [] },
        active: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )

  // No tasks, and none left over from anything earlier at this order.
  await Question.deleteMany({ session: saved._id })

  console.log(`  ✓ Introduction — ${saved.durationMins} min · ${captions.length ? 'captions' : 'no captions'} · 0 tasks · order 0`)
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('✗ Intro ingest failed:', err.message)
  process.exit(1)
})
