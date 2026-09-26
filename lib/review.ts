// Answer checking and spaced repetition for study sets. Pure functions: no DOM, no storage.
import { shuffle } from '@/lib/quiz'
import type { StudyItem } from '@/types'

// ---- Checking typed answers ----

const ARTICLES = /^(the|a|an)\s+/

/** Case, punctuation, articles, accents and plurals don't matter when comparing a typed answer. */
export function normalizeAnswer(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(ARTICLES, '')
    .split(' ').map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ')
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

/** Accepts small typos: 1 letter off for 5+ letter answers, 2 for 10+. */
export function answerMatches(input: string, expected: string) {
  const a = normalizeAnswer(input), b = normalizeAnswer(expected)
  if (!a || !b) return false
  if (a === b) return true
  const tolerance = b.length >= 10 ? 2 : b.length >= 5 ? 1 : 0
  return editDistance(a, b) <= tolerance
}

/** Pairs each typed entry with a different expected item. Order doesn't matter. */
export function gradeEnumeration(inputs: string[], expected: string[]) {
  const matched = expected.map(() => false)
  const entryOk = inputs.map(() => false)
  inputs.forEach((input, i) => {
    const k = expected.findIndex((e, j) => !matched[j] && answerMatches(input, e))
    if (k >= 0) { matched[k] = true; entryOk[i] = true }
  })
  return { matched, entryOk, points: matched.filter(Boolean).length }
}

// ---- Scoring ----

export type Response = { choice?: number; text?: string; entries?: string[]; knew?: boolean }

export const pointsFor = (item: StudyItem) => (item.type === 'enumeration' ? item.answers?.length ?? 0 : 1)

export function isAnswered(item: StudyItem, r: Response | undefined) {
  if (!r) return false
  if (item.type === 'quiz') return r.choice !== undefined
  if (item.type === 'identification') return !!r.text?.trim()
  if (item.type === 'enumeration') return (r.entries ?? []).filter(e => e.trim()).length === item.answers?.length
  if (item.type === 'flashcard') return r.knew !== undefined
  return true
}

/** Points earned. A question counts as "right" for review only when it earns full points. */
export function score(item: StudyItem, r: Response | undefined): number {
  if (!r) return 0
  if (item.type === 'quiz') return r.choice === item.answerIndex ? 1 : 0
  if (item.type === 'identification') return answerMatches(r.text ?? '', item.answer ?? '') ? 1 : 0
  if (item.type === 'enumeration') return gradeEnumeration(r.entries ?? [], item.answers ?? []).points
  if (item.type === 'flashcard') return r.knew ? 1 : 0
  return 0
}

// ---- Spaced repetition (Leitner boxes) ----
// Each question sits in box 1–5. A full-credit answer moves it up a box; anything less sends it back to box 1.
// On a retake, questions missed last time come first, then the weakest boxes; ties are shuffled.

export type ReviewState = { box: number; lastCorrect: boolean; seen: number }
export type Review = Record<string, ReviewState>

export const MAX_BOX = 5

export function recordAttempt(review: Review, results: Record<string, boolean>): Review {
  const next = { ...review }
  for (const [id, correct] of Object.entries(results)) {
    const prev = review[id] ?? { box: 1, lastCorrect: false, seen: 0 }
    next[id] = { box: correct ? Math.min(prev.box + 1, MAX_BOX) : 1, lastCorrect: correct, seen: prev.seen + 1 }
  }
  return next
}

export function retakeOrder(ids: string[], review: Review, random: () => number = Math.random): string[] {
  const missed = ids.filter(id => review[id] && !review[id].lastCorrect)
  const rest = ids.filter(id => !missed.includes(id))
  const byBox = (list: string[]) => shuffle(list, random).sort((a, b) => (review[a]?.box ?? 1) - (review[b]?.box ?? 1))
  return [...byBox(missed), ...byBox(rest)]
}

/** Multiple-choice options in a new order, with the answer index moved to match. */
export function reshuffleOptions(item: StudyItem, random: () => number = Math.random): StudyItem {
  if (item.type !== 'quiz' || !item.options) return item
  const order = shuffle(item.options.map((_, i) => i), random)
  return { ...item, options: order.map(i => item.options![i]), answerIndex: order.indexOf(item.answerIndex!) }
}
