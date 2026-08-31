import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import { TMP_DIR, saveHlsDir } from './uploads.js'

/**
 * Transcoding abstraction — turns one uploaded video into an adaptive HLS
 * ladder (multiple qualities, chunked) so the player (hls.js) can switch down
 * on slow networks. Today it runs a bundled ffmpeg LOCALLY; on AWS this becomes
 * a MediaConvert job (the `aws` branch) with the SAME return shape — nothing
 * downstream changes. Same swap-pattern as storage/gateway.
 *
 * Env to switch:  TRANSCODER=aws  (auto-selected when STORAGE=s3)
 */
const execFileP = promisify(execFile)
const FFMPEG = ffmpegPath
const FFPROBE = ffprobeStatic.path

export const TRANSCODER =
  process.env.TRANSCODER || (process.env.STORAGE === 's3' ? 'aws' : 'local')

// Adaptive ladder — 144p is the slow-net floor, up to 1080p "max". Rungs above
// the source height are dropped later (never upscales), so a 720p source tops
// out at 720p, a 480p source at 480p, etc.
const LADDER = [
  { h: 144, vb: '150k', maxrate: '165k', bufsize: '225k' },
  { h: 240, vb: '400k', maxrate: '440k', bufsize: '600k' },
  { h: 360, vb: '800k', maxrate: '880k', bufsize: '1200k' },
  { h: 480, vb: '1400k', maxrate: '1540k', bufsize: '2100k' },
  { h: 720, vb: '2800k', maxrate: '3080k', bufsize: '4200k' },
  { h: 1080, vb: '5000k', maxrate: '5350k', bufsize: '7500k' },
  { h: 1440, vb: '8000k', maxrate: '8560k', bufsize: '12000k' },
  { h: 2160, vb: '16000k', maxrate: '17120k', bufsize: '24000k' }, // 4K
]

/** Inspect the source: video height, whether it has audio, and its duration. */
async function probe(input) {
  const { stdout } = await execFileP(FFPROBE, [
    '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', input,
  ])
  const info = JSON.parse(stdout)
  const v = (info.streams || []).find((s) => s.codec_type === 'video')
  const hasAudio = (info.streams || []).some((s) => s.codec_type === 'audio')
  const durationSec = Number(info.format?.duration) || 0
  return {
    height: v?.height || 480,
    hasAudio,
    durationSec,
    durationMins: durationSec ? Math.max(1, Math.round(durationSec / 60)) : null,
  }
}

/**
 * Run ffmpeg, reporting real progress. ffmpeg's `-progress` stream emits
 * `out_time=HH:MM:SS.ms`, which against the known duration gives a percentage.
 */
function runFfmpeg(args, durationSec, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ['-progress', 'pipe:1', '-nostats', ...args])
    let stderr = ''

    proc.stdout.on('data', (buf) => {
      const last = [...buf.toString().matchAll(/out_time=(\d+):(\d+):([\d.]+)/g)].pop()
      if (!last || !durationSec || !onProgress) return
      const sec = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])
      onProgress(Math.max(0, Math.min(99, Math.round((sec / durationSec) * 100))))
    })
    proc.stderr.on('data', (b) => {
      stderr += b.toString()
      if (stderr.length > 20000) stderr = stderr.slice(-20000) // keep the tail only
    })

    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) return resolve()
      reject(new Error(`Transcoding failed: ${stderr.split('\n').filter(Boolean).slice(-3).join(' ').trim()}`))
    })
  })
}

/**
 * Transcode `inputPath` → adaptive HLS, store it, and return the master URL.
 * @returns {{ masterUrl: string, key: string, durationMins: number|null }}
 */
export async function transcodeToHls(inputPath, id, { onProgress } = {}) {
  if (TRANSCODER === 'aws') {
    // TODO(AWS): submit a MediaConvert job — input from S3, HLS output to
    //   s3://S3_BUCKET/hls/<id>/, poll/await completion, then return the
    //   CloudFront master URL. Keep this exact return shape.
    throw new Error('AWS MediaConvert transcoder is not configured (set TRANSCODER=aws + MediaConvert env)')
  }

  const { height, hasAudio, durationMins, durationSec } = await probe(inputPath)

  // Never upscale: keep ladder rungs at/below the source height (always ≥1 rung).
  //
  // Capped as well, because the ladder's cost is the SUM of its rungs. A 4K
  // source fills all eight — 34 Mbps together — and a thirteen-minute video
  // then occupies 3.4 GB, against 1 GB for the same video capped at 1080p.
  // Nobody watching a course on an Indian mobile connection will ever pull the
  // 4K rung, so it costs storage and bandwidth and buys nothing. Raise
  // HLS_MAX_HEIGHT deliberately if a particular source is worth it.
  const cap = Number(process.env.HLS_MAX_HEIGHT || 1080)
  const usable = LADDER.filter((r) => r.h <= height && r.h <= cap)
  const rungs = usable.length ? usable : [LADDER[0]]
  const n = rungs.length

  const outDir = join(TMP_DIR, `hls-${id}`)
  mkdirSync(outDir, { recursive: true })

  // Split the source into N streams, scale each rung (width auto, even).
  const splitOuts = rungs.map((_, i) => `[v${i}]`).join('')
  const scales = rungs.map((r, i) => `[v${i}]scale=-2:${r.h}[v${i}out]`).join(';')
  const filter = `[0:v]split=${n}${splitOuts};${scales}`

  const args = ['-y', '-i', inputPath, '-filter_complex', filter]
  rungs.forEach((r, i) => {
    args.push(
      '-map', `[v${i}out]`,
      `-c:v:${i}`, 'libx264', `-b:v:${i}`, r.vb,
      `-maxrate:v:${i}`, r.maxrate, `-bufsize:v:${i}`, r.bufsize,
    )
  })
  // Shared encode settings — fixed GOP so every rung segments at the same points.
  args.push('-preset', 'veryfast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-g', '48', '-keyint_min', '48', '-sc_threshold', '0')
  if (hasAudio) rungs.forEach(() => args.push('-map', 'a:0'))
  args.push('-c:a', 'aac', '-b:a', '96k', '-ac', '2')

  const varMap = rungs.map((_, i) => (hasAudio ? `v:${i},a:${i}` : `v:${i}`)).join(' ')
  args.push(
    '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', join(outDir, 'stream_%v_%03d.ts'),
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', varMap,
    join(outDir, 'stream_%v.m3u8'),
  )

  await runFfmpeg(args, durationSec, onProgress)

  const { masterUrl, key } = await saveHlsDir(outDir, id)
  return { masterUrl, key, durationMins }
}
