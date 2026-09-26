// Finds the passages in instructors' materials that answer a student's question. Pure functions: no DOM, no storage.
import { logicalLines, splitSentences } from '@/lib/chunks'
import type { Passage } from '@/lib/library'
import { isContent, words } from '@/lib/topics'

// Words that shape a question but say nothing about its subject.
const QUERY_FILLER = new Set(`explain define describe tell give list discuss summarize summarise meaning mean means definition difference differences
compare comparison work works working happen happens role purpose importance please about mean kind kinds type types way ways`.split(/\s+/))

/** Light plural folding so "networks" finds "network". Deliberately conservative. */
export function stem(w: string) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 4 && /(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1)
  return w
}

export const queryTerms = (q: string) => [...new Set(words(q).filter(w => isContent(w) && !QUERY_FILLER.has(w)).map(stem))]

export type QuestionPart = { label: string; query: string }

const COMPARATIVE = /\b(compare|comparison|differences?|differ|between|versus|vs\.?)\b/i
const LEAD = /^(explain|define|describe|discuss|summari[sz]e|tell me about|what is|what are|what's|who is|who are)\s+(.+?)[\s.?!]*$/i
const NEW_QUESTION = /\s+and\s+(?=(?:what|how|why|when|where|which|who|explain|define|describe|list|give)\b)/i

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Splits a message that asks several things into separate parts, each answered on its own:
 * separate lines or sentences, "…? …?", "X; Y", numbered lists, "what is X and how does Y…",
 * and "explain X, Y and Z". Comparisons ("difference between X and Y") stay whole.
 */
export function splitQuestion(input: string): QuestionPart[] {
  const segments = input
    .split(/\n+|(?<=\?)\s+|;\s*/)
    .flatMap(s => s.split(NEW_QUESTION))
    .map(s => s.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim())
    .filter(s => queryTerms(s).length)

  const parts: QuestionPart[] = []
  for (const seg of segments) {
    const lead = COMPARATIVE.test(seg) ? null : seg.match(LEAD)
    const pieces = lead ? lead[2].split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map(p => p.trim()).filter(Boolean) : []
    if (lead && pieces.length > 1 && pieces.every(p => p.split(' ').length <= 5 && queryTerms(p).length)) {
      for (const p of pieces) parts.push({ label: capitalize(p), query: `${lead[1]} ${p}` })
    } else parts.push({ label: capitalize(seg.replace(/\s+/g, ' ')), query: seg })
  }
  // "What is overfitting and how do I prevent it?": "it" means the previous part's topic.
  for (let i = 1; i < parts.length; i++)
    if (/\b(it|this|that|they|them|its|their)\b/i.test(parts[i].label)) parts[i].query += ` ${queryTerms(parts[i - 1].query).join(' ')}`
  const unique = parts.filter((p, i) => parts.findIndex(q => q.label.toLowerCase() === p.label.toLowerCase()) === i)
  return (unique.length ? unique : [{ label: capitalize(input.trim()), query: input }]).slice(0, 6)
}

export type Index = { passages: Passage[]; tf: Map<string, number>[]; len: number[]; avgLen: number; df: Map<string, number> }

export function buildIndex(passages: Passage[]): Index {
  const df = new Map<string, number>()
  const tf = passages.map(p => {
    const counts = new Map<string, number>()
    for (const w of words(p.text)) if (isContent(w)) { const s = stem(w); counts.set(s, (counts.get(s) ?? 0) + 1) }
    for (const s of counts.keys()) df.set(s, (df.get(s) ?? 0) + 1)
    return counts
  })
  const len = tf.map(c => [...c.values()].reduce((a, b) => a + b, 0))
  return { passages, tf, len, avgLen: len.reduce((a, b) => a + b, 0) / (len.length || 1), df }
}

export type Hit = { passage: Passage; score: number; excerpt: string }

/** The few sentences of a passage that carry the matched terms, keeping its line breaks. */
export function excerptFor(text: string, terms: string[], max = 460): string {
  if (text.length <= max) return text
  const units = logicalLines(text).flatMap(line => splitSentences(line).map((s, i) => ({ s, newLine: i === 0 })))
  const score = (s: string) => new Set(words(s).map(stem).filter(w => terms.includes(w))).size
  let best = 0
  units.forEach((u, i) => { if (score(u.s) > score(units[best].s)) best = i })
  let start = best, end = best, size = units[best].s.length
  while (true) {
    const next = end + 1 < units.length && size + units[end + 1].s.length <= max
    const prev = start > 0 && size + units[start - 1].s.length <= max
    if (next) size += units[++end].s.length
    else if (prev) size += units[--start].s.length
    else break
  }
  const body = units.slice(start, end + 1).map((u, i) => (i && u.newLine ? '\n' : i ? ' ' : '') + u.s).join('')
  return (start > 0 ? '… ' : '') + body + (end < units.length - 1 ? ' …' : '')
}

/** BM25 over passages, requiring the passage to cover at least half of the question's terms. */
export type SearchOptions = {
  subjectId?: string | null
  /** Only passages from these files (instructor / subject / type / date filters resolve to this). */
  materialIds?: Set<string>
  limit?: number
  /** Share of the question's terms a passage must contain. Broad requests (reviewers) go lower. */
  minCoverage?: number
  /** Keep hits scoring at least this share of the best one. */
  minRatio?: number
}

export function search(index: Index, query: string, opts: SearchOptions = {}): Hit[] {
  const terms = queryTerms(query)
  if (!terms.length) return []
  const n = index.passages.length
  const rawWords = words(query).filter(w => isContent(w) && !QUERY_FILLER.has(w))
  const phrases = rawWords.slice(1).map((w, i) => `${rawWords[i]} ${w}`)
  const scored: Hit[] = []
  index.passages.forEach((p, i) => {
    if (opts.subjectId && p.subjectId !== opts.subjectId) return
    if (opts.materialIds && !opts.materialIds.has(p.materialId)) return
    const tf = index.tf[i]
    const matched = terms.filter(t => tf.has(t))
    if (matched.length < Math.max(1, Math.ceil(terms.length * (opts.minCoverage ?? 0.5)))) return
    let score = 0
    for (const t of matched) {
      const df = index.df.get(t) ?? 0
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
      const f = tf.get(t)!
      score += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * index.len[i] / index.avgLen))
    }
    const lower = p.text.toLowerCase()
    for (const ph of phrases) if (lower.includes(ph)) score *= 1.3
    // A passage that defines the topic ("Overfitting happens when…") beats one that only mentions it.
    const subject = rawWords.join(' ')
    if (subject && new RegExp(`(^|[.\\n]\\s*)${subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*,?\\s+(is|are|happens|occurs|refers|means|describes|estimates|measures|controls)\\b`).test(lower)) score *= 1.6
    score *= 0.6 + 0.4 * (matched.length / terms.length)
    scored.push({ passage: p, score, excerpt: '' })
  })
  scored.sort((a, b) => b.score - a.score)
  const top = scored[0]?.score ?? 0
  const hits: Hit[] = []
  for (const h of scored) {
    if (h.score < top * (opts.minRatio ?? 0.45) || hits.length >= (opts.limit ?? 3)) break
    const excerpt = excerptFor(h.passage.text, terms)
    if (hits.some(x => x.excerpt === excerpt)) continue
    hits.push({ ...h, excerpt })
  }
  return hits
}

/**
 * Pseudo-relevance feedback: search, learn which other terms the best passages use, and search again with them.
 * Lets a broad request ("machine learning") reach passages that never say those exact words.
 */
export function expandedSearch(index: Index, query: string, opts: SearchOptions = {}): { hits: Hit[]; expansion: string[] } {
  const first = search(index, query, { ...opts, limit: 5, minCoverage: opts.minCoverage ?? 0.5 })
  if (!first.length) return { hits: [], expansion: [] }
  const base = new Set(queryTerms(query))
  const weight = new Map<string, number>()
  const n = index.passages.length
  for (const h of first.slice(0, 3)) {
    const tf = index.tf[index.passages.indexOf(h.passage)]
    for (const [t, f] of tf) {
      if (base.has(t) || t.length < 4) continue
      const idf = Math.log(1 + n / ((index.df.get(t) ?? 0) + 1))
      weight.set(t, (weight.get(t) ?? 0) + f * idf)
    }
  }
  const expansion = [...weight].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t)
  // The expanded query only needs to hit a few of its terms; the original terms still dominate the ranking.
  const second = search(index, [query, ...expansion].join(' '), { ...opts, minCoverage: 1 / (base.size + expansion.length), minRatio: opts.minRatio ?? 0.25 })
  const seen = new Set(first.map(h => h.passage.id))
  return { hits: [...first, ...second.filter(h => !seen.has(h.passage.id))].slice(0, opts.limit ?? 10), expansion }
}

/** Closest term the materials actually use, for fixing typos ("overfiting" → "overfitting"). */
export function closestTerm(word: string, vocab: Map<string, number>): string | null {
  const w = stem(word)
  if (vocab.has(w) || w.length < 4) return null
  const maxDist = w.length >= 8 ? 2 : 1
  let best: string | null = null, bestScore = -Infinity
  for (const [t, df] of vocab) {
    if (Math.abs(t.length - w.length) > maxDist || t.includes(' ')) continue
    const d = editDistance(w, t)
    if (d <= maxDist && df - d * 1000 > bestScore) { best = t; bestScore = df - d * 1000 }
  }
  return best
}

function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]
}

export type AnswerPart = QuestionPart & { hits: Hit[] }

export const answer = (index: Index, input: string, subjectId?: string | null, materialIds?: Set<string>): AnswerPart[] =>
  splitQuestion(input).map(part => ({ ...part, hits: search(index, part.query, { subjectId, materialIds }) }))
