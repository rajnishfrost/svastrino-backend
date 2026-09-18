// Turns the Google-Docs markdown export of the FAQs doc into the seed's
// data/faqs.json. The doc is one flat list of `#` sections; the page shows two
// groups, so SECTIONS below maps each doc heading onto [group, category] and
// fixes the order they appear in.
//
// Re-run after replacing data/faqs-source.md:  npm run build:faqs
// Source doc: https://docs.google.com/document/d/1aB-6uPpmcLWQAeM2hUpNI5Rrhy0nJpir63PB3XIThJQ/
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, 'data', 'faqs-source.md')
const OUT = join(here, 'data', 'faqs.json')

// Doc heading (or "Skill-Build/<sub-heading>") → [group, category]. Insertion
// order is display order: groups first, then categories within a group.
const SECTIONS = new Map([
  ['Skill-Build/Courses:', ['Skill-Build', 'Nirmaan']],
  ['Skill-Build/Psychometric Testing:', ['Skill-Build', 'Psychometric Testing']],
  ['About Svastrino', ['Svastrino Services', 'About Svastrino']],
  ['Process Basics', ['Svastrino Services', 'Process Basics']],
  ['Mentoring Programs', ['Svastrino Services', 'Mentoring Programs']],
  ["Bull's Eye Program", ['Svastrino Services', "Bull's Eye Program"]],
  ['Bloom Program', ['Svastrino Services', 'Bloom Program']],
  ['Breakthrough program', ['Svastrino Services', 'Breakthrough Program']],
  ['Book Online', ['Svastrino Services', 'Book Online']],
  ['Payments & Packages', ['Svastrino Services', 'Payments & Packages']],
  ['Login/ Signup', ['Svastrino Services', 'Login / Signup']],
  ['Career Library', ['Svastrino Services', 'Career Library']],
  ['Outcomes', ['Svastrino Services', 'Outcomes']],
  ['Exclusions', ['Svastrino Services', 'Exclusions']],
  ['Why Svastrino?', ['Svastrino Services', 'Why Svastrino?']],
])

export const FAQ_GROUPS = ['Skill-Build', 'Svastrino Services']

// Google Docs escapes markdown punctuation on export: "2\.", "Q\&A", "15% \+".
const unescape = (s) => s.replace(/\\([\\`*_{}[\]()#+\-.!>~|&])/g, '$1')
const clean = (s) => unescape(s).replace(/\*\*/g, '').replace(/ /g, ' ').trim()

export function parseFaqs(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const rows = []
  const buf = []
  let h1 = null
  let h2 = null
  let cur = null

  const flush = () => {
    if (!cur) return
    while (buf.length && !buf[buf.length - 1].trim()) buf.pop()
    const answer = buf.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    if (!answer) throw new Error(`FAQ has no answer: ${cur.question}`)
    rows.push({ ...cur, answer })
    cur = null
    buf.length = 0
  }

  for (const raw of lines) {
    const trimmed = raw.trim()

    // A heading closes the answer that was being collected. The doc has a few
    // empty "# " spacer headings — those keep the current section.
    const heading = trimmed.match(/^(#{1,6})\s*(.*)$/)
    if (heading) {
      const name = clean(heading[2])
      flush()
      if (heading[1].length === 1) {
        h1 = name || null
        h2 = null
      } else if (name) {
        h2 = name
      }
      continue
    }

    // "1. Question?" — only inside a heading we map, so stray numbered lists
    // elsewhere in the doc can't be mistaken for questions.
    const key = h1 && h2 ? `${h1}/${h2}` : h1
    const question = trimmed.match(/^(\d+)\\?\.\s+(.+)$/)
    if (question && SECTIONS.has(key)) {
      flush()
      const [group, section] = SECTIONS.get(key)
      cur = { group, section, num: Number(question[1]), question: clean(question[2]) }
      continue
    }

    if (cur) buf.push(unescape(raw).replace(/ /g, ' ').replace(/\s+$/, ''))
  }
  flush()

  const categories = [...SECTIONS.values()].map(([, category]) => category)
  rows.sort(
    (a, b) =>
      FAQ_GROUPS.indexOf(a.group) - FAQ_GROUPS.indexOf(b.group) ||
      categories.indexOf(a.section) - categories.indexOf(b.section) ||
      a.num - b.num
  )

  return rows.map(({ group, section, question, answer }, i) => ({
    group,
    section,
    question,
    answer,
    order: i,
  }))
}

// Run directly (npm run build:faqs) — importing this file just gives parseFaqs.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const faqs = parseFaqs(fs.readFileSync(SRC, 'utf8'))
  fs.writeFileSync(OUT, `${JSON.stringify(faqs, null, 2)}\n`)

  const counts = new Map()
  for (const f of faqs) {
    if (!counts.has(f.group)) counts.set(f.group, new Map())
    const g = counts.get(f.group)
    g.set(f.section, (g.get(f.section) || 0) + 1)
  }
  for (const [group, sections] of counts) {
    const total = [...sections.values()].reduce((a, b) => a + b, 0)
    console.log(`\n${group}  (${total})`)
    for (const [section, n] of sections) console.log(`   ${section.padEnd(24)} ${n}`)
  }
  console.log(`\n✓ ${faqs.length} FAQs → data/faqs.json`)
}
