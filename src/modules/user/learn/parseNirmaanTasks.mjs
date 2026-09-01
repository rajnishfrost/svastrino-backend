import { readFileSync, writeFileSync } from 'node:fs'

// The sheet is laid out for a reader, not a parser: a "Week N" row opens a
// block, a "Rule of the Week" row follows, then six day rows, and the week's
// title sits in the second column of its opening row.
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

// Paths may be passed in; the originals stay the defaults so the old command
// line keeps working.
const IN = process.argv[2] || '/tmp/nirmaan-dl/Nirmaan Tasks - Sheet1.csv'
const OUT = process.argv[3] || '/tmp/nirmaan-weeks.json'

const rows = parseCsv(readFileSync(IN, 'utf8')).slice(1)
const weeks = []
let cur = null
for (const r of rows) {
  const [a = '', b = '', c = '', d = ''] = r.map(x => (x || '').trim())
  const wk = /^week\s*(\d+)/i.exec(a)
  // The third column on a Week row carries a note when the week works
  // differently — week 24 has no daily tasks by design, and says so there.
  if (wk) { cur = { week: +wk[1], title: b, note: c, rule: '', days: [] }; weeks.push(cur); continue }
  if (!cur) continue
  if (/^rule of the week/i.test(a)) { cur.rule = b; continue }
  const dy = /^day\s*(\d+)/i.exec(b)
  if (dy && c) cur.days.push({ day: +dy[1], task: c, example: d })
}
weeks.sort((x, y) => x.week - y.week)
writeFileSync(OUT, JSON.stringify(weeks, null, 2))

console.log(`  weeks       : ${weeks.length}`)
console.log(`  tasks       : ${weeks.reduce((n, w) => n + w.days.length, 0)}`)
console.log(`  bina rule   : ${weeks.filter(w => !w.rule).map(w => w.week).join(', ') || 'koi nahi'}`)
console.log(`  bina title  : ${weeks.filter(w => !w.title).map(w => w.week).join(', ') || 'koi nahi'}`)
console.log(`  6 din nahi  : ${weeks.filter(w => w.days.length !== 6).map(w => `W${w.week}(${w.days.length})`).join(', ') || 'koi nahi'}`)
console.log('  ── namoone ──')
for (const w of [weeks[0], weeks[11], weeks[23]]) {
  console.log(`     W${w.week}: ${w.title}`)
  console.log(`         rule: ${w.rule.slice(0, 66)}`)
  if (w.days[0]) console.log(`         day1: ${w.days[0].task.slice(0, 66)}`)
}
