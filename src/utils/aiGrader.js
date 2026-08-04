/**
 * AI grader for the Nirmaan scholarship (open-ended reflective answers).
 *
 * Each question is worth 1 mark. We send all the questions + the student's typed
 * answers to OpenAI in ONE call and get back 0/1 per question plus a short note.
 * The model decides how many marks the student earns overall (sum of the 1-mark
 * awards). Model is configurable via OPENAI_MODEL; the default gpt-4o-mini is the
 * cheap-yet-capable pick for this kind of short-answer judgement.
 *
 * Config (in .env.local):
 *   OPENAI_API_KEY = sk-...          (required for real grading)
 *   OPENAI_MODEL   = gpt-4o-mini     (optional; default below)
 *
 * If the key is missing or the API call fails, we fall back to a simple length/
 * substance heuristic so a live submission NEVER fails — the result just isn't
 * AI-graded (gradedModel = 'heuristic-fallback', which the admin can re-grade).
 */

const DEFAULT_MODEL = 'gpt-4o-mini'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

const SYSTEM_PROMPT = `You grade a school/college career-scholarship test made of OPEN-ENDED, reflective questions (e.g. "What problem have you solved so far, and did you think you would solve it?").

Each question is worth exactly 1 mark. For every question decide score = 1 or score = 0:
- Award 1 when the answer genuinely and thoughtfully addresses THAT question: it is specific, coherent, in the student's own words, and shows real reflection or lived experience. Small grammar/spelling mistakes are fine — judge the thinking, not the language. Answers in Hindi, English or Hinglish are all acceptable.
- Award 0 when the answer is blank, off-topic, copied-looking generic filler, gibberish/keyboard-mash, or too thin to show any real reflection.
Be fair but not a pushover: a one-line non-answer scores 0; an honest, specific reflection scores 1.

Return STRICT JSON only, no prose:
{"marks":[{"id":"<question id>","score":0 or 1,"feedback":"<max 12 words>"}]}
Include one entry per question id you are given, in the same order.`

/** Very rough fallback when the API is unavailable — substance by word count. */
function heuristicGrade(items) {
  return items.map((it) => {
    const words = String(it.answer || '').trim().split(/\s+/).filter(Boolean)
    const distinct = new Set(words.map((w) => w.toLowerCase())).size
    const ok = words.length >= 15 && distinct >= 8 // some real, varied content
    return { id: it.id, score: ok ? 1 : 0, feedback: ok ? 'Auto (no AI): looks substantive' : 'Auto (no AI): too thin' }
  })
}

/**
 * Grade a set of {id, question, guidance, answer} items.
 * @returns {Promise<{ marks: Array<{id,score,feedback}>, model: string }>}
 */
export async function gradeAnswers(items) {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return { marks: [], model: 'none' }

  const key = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL
  if (!key) {
    console.warn('⚠ OPENAI_API_KEY not set — scholarship answers graded by fallback heuristic.')
    return { marks: heuristicGrade(list), model: 'heuristic-fallback' }
  }

  const payload = {
    model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          questions: list.map((it) => ({
            id: it.id,
            question: it.question,
            what_a_good_answer_shows: it.guidance || undefined,
            student_answer: it.answer || '',
          })),
        }),
      },
    ],
  }

  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '{}'
    const parsed = JSON.parse(content)
    const raw = Array.isArray(parsed.marks) ? parsed.marks : []
    const byId = new Map(raw.map((m) => [String(m.id), m]))

    // Normalise to one mark per input id (missing → 0), clamp to 0/1.
    const marks = list.map((it) => {
      const m = byId.get(String(it.id))
      const score = m && Number(m.score) >= 1 ? 1 : 0
      return { id: it.id, score, feedback: String(m?.feedback || '').slice(0, 140) }
    })
    return { marks, model }
  } catch (err) {
    console.error('✗ AI grading failed, using fallback heuristic:', err.message)
    return { marks: heuristicGrade(list), model: 'heuristic-fallback' }
  }
}
