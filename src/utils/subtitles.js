/**
 * Subtitle helpers. Browsers (and the <track> element) only render WebVTT, not
 * SRT — but the two are near-identical, so we convert SRT → VTT on upload and
 * keep the exact timestamps untouched (so caption timing stays perfectly in
 * sync with the video, in any language).
 */

// "00:01:02,500" (SRT, comma) → "00:01:02.500" (VTT, dot). Also pads a bare
// "M:SS" or "MM:SS.mmm" to the "HH:MM:SS.mmm" VTT wants.
function normalizeStamp(raw) {
  let t = raw.trim().replace(',', '.')
  const parts = t.split(':')
  if (parts.length === 2) t = `00:${parts[0]}:${parts[1]}` // M:SS → 00:MM:SS
  const [h, m, rest = '0'] = t.split(':')
  const [s, ms = '000'] = rest.split('.')
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3).slice(0, 3)}`
}

const TIMING_RE = /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})(.*)$/

/** True if the text already looks like WebVTT (has the WEBVTT header). */
export function isVtt(text) {
  return /^﻿?WEBVTT/.test(String(text || ''))
}

/**
 * Convert SRT text to WebVTT. If it's already VTT, it's returned as-is (with a
 * guaranteed header). Cue numbers are dropped (VTT allows optional ids); only
 * the timing line's format changes — the actual times are preserved exactly.
 */
export function srtToVtt(input) {
  let text = String(input || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (isVtt(text)) {
    // Already VTT — just make sure it has the header line and trailing newline.
    return text.endsWith('\n') ? text : text + '\n'
  }

  const out = ['WEBVTT', '']
  const blocks = text.split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    if (!lines.length) continue
    // Drop a leading cue-number line (SRT numbers each cue "1", "2", …).
    if (/^\d+$/.test(lines[0].trim())) lines.shift()
    if (!lines.length) continue

    const m = TIMING_RE.exec(lines[0])
    if (!m) continue // not a timed cue — skip stray text
    const cueSettings = (m[3] || '').trim()
    out.push(`${normalizeStamp(m[1])} --> ${normalizeStamp(m[2])}${cueSettings ? ' ' + cueSettings : ''}`)
    out.push(...lines.slice(1)) // the caption text lines
    out.push('') // blank line between cues
  }
  return out.join('\n') + '\n'
}

/**
 * Parse VTT into cues [{ start, end, text }] so each cue's TEXT can be
 * translated while its timing is copied verbatim. `start`/`end` are the raw
 * timing strings; `settings` keeps any per-cue position settings.
 */
export function parseVttCues(vtt) {
  const text = String(vtt || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const cues = []
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n')
    const idx = lines.findIndex((l) => TIMING_RE.test(l))
    if (idx === -1) continue
    const m = TIMING_RE.exec(lines[idx])
    cues.push({
      start: normalizeStamp(m[1]),
      end: normalizeStamp(m[2]),
      settings: (m[3] || '').trim(),
      text: lines.slice(idx + 1).join('\n').trim(),
    })
  }
  return cues
}

/** Rebuild a VTT file from cues whose `text` may have been translated. */
export function buildVtt(cues) {
  const out = ['WEBVTT', '']
  for (const c of cues) {
    out.push(`${c.start} --> ${c.end}${c.settings ? ' ' + c.settings : ''}`)
    out.push(c.text || '')
    out.push('')
  }
  return out.join('\n') + '\n'
}
