import mongoose from 'mongoose'
import { readFileSync } from 'node:fs'
import { Testimonial } from './testimonial.model.js'

/**
 * Bring the reviews sheet into the testimonials collection.
 *
 * The sheet is two columns — Name, Testimony — and is the approved wording, so
 * a person already on file has their quote replaced and anyone new is added.
 * Nothing is ever deleted here: a testimonial missing from the sheet is left
 * exactly as it is, because this script cannot tell "dropped from the sheet"
 * apart from "not in this export".
 *
 * Names are matched loosely — case, punctuation and a parenthetical aside all
 * ignored, so "Gurjas Sahni (Sonia)" finds "Gurjas Sahni" rather than adding a
 * second row for the same person.
 *
 * Run:  node src/modules/user/content/importReviews.js <reviews.csv> [--dry]
 */

/** Minimal CSV reader — quoted fields and newlines inside a cell included. */
function parseCsv(text) {
  const rows = []
  let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') { cell += c; continue }
      if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const key = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]/g, '')

async function main() {
  const file = process.argv[2]
  const dry = process.argv.includes('--dry')
  if (!file || file.startsWith('--')) throw new Error('reviews.csv ka path do')

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/svastrino'
  await mongoose.connect(uri)
  console.log('db:', uri.replace(/\/\/[^@]*@/, '//***@'), dry ? '(dry run)' : '')

  const rows = parseCsv(readFileSync(file, 'utf8'))
    .slice(1) // header
    .map(([name, quote]) => ({ name: String(name || '').trim(), quote: String(quote || '').trim() }))
    .filter((r) => r.name && r.quote)

  const existing = await Testimonial.find({}).lean()
  let maxOrder = existing.reduce((m, t) => Math.max(m, t.order || 0), 0)
  let updated = 0, added = 0, same = 0

  for (const r of rows) {
    const hit = existing.find((t) => key(t.name) === key(r.name))
    if (!hit) {
      // New voice: added quiet — not featured, at the end of the list — so it
      // is a person's decision, not an import's, which quotes lead a page.
      if (dry) console.log(`  ADD     ${r.name}`)
      else await Testimonial.create({ name: r.name, quote: r.quote, order: ++maxOrder, active: true, featured: false })
      added++
      continue
    }
    if (hit.quote.trim() === r.quote) { same++; continue }
    if (dry) console.log(`  UPDATE  ${hit.name}  ${hit.quote.length}ch -> ${r.quote.length}ch`)
    else await Testimonial.updateOne({ _id: hit._id }, { $set: { quote: r.quote } })
    updated++
  }

  const missing = existing.filter((t) => !rows.some((r) => key(r.name) === key(t.name)))
  for (const m of missing) console.log(`  kept    ${m.name}  (sheet me nahi — chhua nahi)`)

  console.log(`\n  sheet rows=${rows.length}  updated=${updated}  added=${added}  already same=${same}`)
  await mongoose.disconnect()
}

main().catch((e) => { console.error(e.message); process.exit(1) })
