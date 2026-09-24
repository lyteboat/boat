// compute.js — bucket_detail: the judgement's wording.
const JUDGE_TEXT = { under: '偏低', ok: '在区间内', over: '偏高' }

export function judge_text(judge) {
  return JUDGE_TEXT[judge] ?? '—'
}
