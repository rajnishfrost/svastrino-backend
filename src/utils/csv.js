/**
 * Minimal RFC-4180 CSV reader/writer — no dependency, because the only CSV we
 * handle is the organisation's student roster (a handful of short text columns).
 *
 * Handles what real spreadsheets actually emit: a UTF-8 BOM from Excel, CRLF
 * line endings, quoted fields containing commas/newlines, and "" as an escaped
 * quote inside a quoted field.
 */

/** Split raw CSV text into rows of string cells. */
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '') // strip Excel's BOM
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++ } // "" → a literal quote
        else quoted = false
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"') { quoted = true; continue }
    if (ch === ',') { row.push(cell); cell = ''; continue }
    if (ch === '\r') continue // CRLF — the \n below ends the row
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue }
    cell += ch
  }
  // Trailing cell/row (file not ending in a newline).
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }

  // Drop fully blank lines — trailing newlines are the norm, not an error.
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''))
}

/**
 * Parse CSV into objects keyed by the header row. Headers are normalised
 * (lowercased, non-alphanumerics stripped) so "Roll No.", "roll_no" and
 * "rollNo" all land on the same key.
 */
export function parseCsvRecords(text) {
  const rows = parseCsv(text)
  if (!rows.length) return { headers: [], records: [] }

  const raw = rows[0].map((h) => String(h).trim())
  const headers = raw.map(normaliseHeader)
  const records = rows.slice(1).map((cells, i) => {
    const rec = { __line: i + 2 } // 1-based line number in the file, header = 1
    headers.forEach((h, j) => { if (h) rec[h] = String(cells[j] ?? '').trim() })
    return rec
  })
  return { headers, rawHeaders: raw, records }
}

/** "Roll No." → "rollno" — used to match columns loosely. */
export const normaliseHeader = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Quote a cell only when it needs it, escaping embedded quotes. */
const cell = (v) => {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Build CSV text from a header array + array-of-arrays rows. */
export function buildCsv(headers, rows) {
  const lines = [headers.map(cell).join(',')]
  for (const r of rows) lines.push(r.map(cell).join(','))
  return lines.join('\r\n') + '\r\n'
}
