/**
 * Caption translation via OpenAI. Translates each cue's TEXT only — the caller
 * keeps the original timings — so a translated track stays perfectly in sync
 * with the video. All cues go in ONE request (cheap + keeps context) and come
 * back as a JSON array in the same order.
 *
 * Config: OPENAI_API_KEY (required) · OPENAI_MODEL (default gpt-4o-mini).
 * Without a key it throws — translation is an explicit, admin-triggered action,
 * so failing loudly is better than silently returning the source text.
 */
const DEFAULT_MODEL = 'gpt-4o-mini'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

/**
 * @param {string[]} texts     cue texts to translate (order preserved)
 * @param {string} fromLabel   source language label (e.g. "Hindi")
 * @param {string} toLabel     target language label (e.g. "English")
 * @returns {Promise<string[]>} translated texts, same length/order
 */
export async function translateCues(texts, fromLabel, toLabel) {
  const list = Array.isArray(texts) ? texts : []
  if (!list.length) return []

  const key = process.env.OPENAI_API_KEY
  if (!key) throw Object.assign(new Error('Translation needs OPENAI_API_KEY set on the server'), { status: 400 })
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL

  const system = `You are a professional subtitle translator. Translate each caption line from ${fromLabel || 'the source language'} to ${toLabel}. Rules:
- Translate meaning naturally, as spoken subtitles — concise, not literal word-for-word.
- Keep it roughly the same length so it fits on screen.
- Do NOT merge, split, add or drop lines. Return exactly one translation per input line, in the SAME order.
- Keep any line as-is if it is only a number, symbol or proper noun with no translatable text.
Return STRICT JSON: {"lines": ["...","..."]} with the same number of items as the input.`

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify({ lines: list }) },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw Object.assign(new Error(`OpenAI ${res.status}: ${body.slice(0, 160)}`), { status: 502 })
  }
  const data = await res.json()
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}')
  const out = Array.isArray(parsed.lines) ? parsed.lines : []
  // Guarantee alignment: fall back to the source line for any missing slot.
  return list.map((src, i) => (typeof out[i] === 'string' && out[i].trim() ? out[i] : src))
}
