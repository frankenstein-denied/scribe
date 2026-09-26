// Builds quiz questions from the answer cells a student selected. Rule-based (no AI yet): questions come from
// sentences in the instructor's material, built around their key terms. Pure functions: no DOM, no storage.
import { logicalLines, splitSentences } from '@/lib/chunks'
import type { Passage } from '@/lib/library'
import { termCounts } from '@/lib/topics'
import type { Citation, StudyItem } from '@/types'

export type QuizSource = { text: string; passage: Pick<Passage, 'id' | 'materialId' | 'title' | 'subjectCode' | 'profName' | 'page'> }

export type QuizKind = 'multiple-choice' | 'identification' | 'enumeration' | 'flashcards'
export const QUIZ_KINDS: { kind: QuizKind; label: string; hint: string }[] = [
  { kind: 'multiple-choice', label: 'Multiple choice', hint: 'Pick the right term out of four' },
  { kind: 'identification', label: 'Identification', hint: 'Read the description, type the term' },
  { kind: 'enumeration', label: 'Enumeration', hint: 'List every item, in any order' },
  { kind: 'flashcards', label: 'Flashcards', hint: 'Flip each card, then say if you knew it' },
]

const BLANK = '_____'
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const termRegex = (t: string) => new RegExp(`(?<![\\w-])${escape(t).replace(/ /g, '\\s+')}(?![\\w-])`, 'gi')
const display = (s: string) => (/^[A-Z0-9]{2,}$/.test(s) ? s : s.toLowerCase())
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const wordCount = (t: string) => t.trim().split(/\s+/).length

export function shuffle<T>(items: T[], random: () => number = Math.random) {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

const cleanText = (text: string) => text.replace(/^…\s*|\s*…$/g, '')
const sentencesOf = (text: string) => logicalLines(cleanText(text))
  .flatMap(splitSentences)
  .map(s => s.trim())
  .filter(s => s.length >= 30 && s.length <= 280 && wordCount(s) >= 5)

const citationFor = (s: QuizSource): Citation => ({ n: 1, chunkId: s.passage.id, materialId: s.passage.materialId, materialTitle: s.passage.title, subjectCode: s.passage.subjectCode, profName: s.passage.profName, page: s.passage.page ?? 0 })

/** "Gradient descent is an algorithm…" → "It is an algorithm…"; otherwise the term becomes a blank. */
function describeWithoutTerm(sentence: string, term: string) {
  const re = termRegex(term)
  if (new RegExp(`^${re.source}`, 'i').test(sentence)) return sentence.replace(re, (_m, offset: number) => (offset === 0 ? 'It' : 'it'))
  return sentence.replace(re, BLANK)
}

// ---- Enumeration: lists written in the material ----

const LIST_TRIGGER = /\b(include|includes|including|such as|namely|are|is|consist of|consists of|involve|involves|with|like|:)\s*$/i
const STRONG_TRIGGER = /\b(include|includes|including|such as|namely|consists? of)\s*$/i
const ITEM_OK = (s: string) => s.length >= 2 && wordCount(s) <= 5 && !/[.;!?]/.test(s)

type FoundList = { lead: string; items: string[]; sentence: string }

/** Finds "… is controlled with regularization, dropout, and early stopping." style lists. */
export function listsIn(text: string): FoundList[] {
  const found: FoundList[] = []
  const lines = logicalLines(cleanText(text))
  for (const sentence of lines.flatMap(splitSentences)) {
    const body = sentence.trim().replace(/[.!?]+$/, '')
    const firstComma = body.indexOf(', ')
    // "A, B, and C" (3+ items) after a trigger word, or "A and B" after a strong trigger like "include".
    const listStart = (() => {
      const before = firstComma > 0 ? body.slice(0, firstComma) : body
      const words = before.split(' ')
      // With commas, the first item sits just before the first comma; without, "A and B" can be up to ~11 words.
      const span = firstComma > 0 ? 6 : 12
      for (let k = words.length - 1; k >= Math.max(1, words.length - span); k--) {
        const lead = words.slice(0, k).join(' ')
        if (lead && (firstComma > 0 ? LIST_TRIGGER : STRONG_TRIGGER).test(lead)) return lead.length + 1
      }
      return -1
    })()
    if (listStart < 0) continue
    const lead = body.slice(0, listStart).trim()
    const items = body.slice(listStart).split(/\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/).map(s => s.trim()).filter(Boolean)
    if (items.length < 2 || items.length > 8 || !items.every(ITEM_OK)) continue
    if (items.length === 2 && !STRONG_TRIGGER.test(lead)) continue
    found.push({ lead, items, sentence: sentence.trim() })
  }
  // Slide-style lists: a short heading followed by 2+ short bullet lines.
  for (let i = 0; i < lines.length; i++) {
    const bullets: string[] = []
    for (let j = i + 1; j < lines.length && wordCount(lines[j]) <= 5 && !/[.!?]$/.test(lines[j]); j++) bullets.push(lines[j].replace(/^[-•*]\s*/, ''))
    if (bullets.length >= 2 && wordCount(lines[i]) <= 6 && !/[.!?]$/.test(lines[i])) {
      found.push({ lead: `Under “${lines[i]}”, the material lists`, items: bullets, sentence: [lines[i], ...bullets].join(' / ') })
      i += bullets.length
    }
  }
  return found
}

// ---- Question building ----

type TermPick = { source: QuizSource; si: number; sentence: string; answer: string; shown: string }

/** One key term per sentence, spread across the selected cells. Shared by every term-based quiz type. */
function pickTerms(sources: QuizSource[], perSource: number): { picks: TermPick[][]; pool: string[]; counts: Record<string, number> } {
  // Terms worth asking about: phrases ("learning rate"), or words that recur across the selection.
  const counts = termCounts(sources.map(s => s.text).join('\n'), 120)
  const pool = Object.keys(counts).filter(t => t.length >= 4 && (t.includes(' ') || (counts[t] >= 2 && !/ly$/.test(t))))
  const used = new Set<string>()
  const picks = sources.map((source, si) => {
    const out: TermPick[] = []
    for (const sentence of sentencesOf(source.text)) {
      if (out.length >= perSource) break
      const inSentence = pool.filter(t => termRegex(t).test(sentence))
      // Never pick half a phrase: "rate" out of "learning rate" is a giveaway.
      const answer = inSentence
        .filter(t => !used.has(t) && !inSentence.some(o => o !== t && o.includes(t)))
        .sort((a, b) => wordCount(b) - wordCount(a) || counts[b] - counts[a])[0]
      if (!answer) continue
      used.add(answer)
      out.push({ source, si, sentence, answer, shown: sentence.match(termRegex(answer))![0] })
    }
    return out
  })
  return { picks, pool, counts }
}

function buildTermItem(kind: QuizKind, p: TermPick, id: string, pool: string[], counts: Record<string, number>, random: () => number): StudyItem {
  const base = { id, explanation: p.sentence, citations: [citationFor(p.source)] }
  const answer = display(p.shown)
  if (kind === 'flashcards') return { ...base, type: 'flashcard', front: capitalize(answer), back: p.sentence }
  if (kind === 'multiple-choice') {
    // Wrong choices: same shape as the answer (phrase vs word), common in the selection, absent from the sentence,
    // and never overlapping each other ("gradient" next to "gradient descent" gives the game away).
    const candidates = pool
      .filter(t => !t.includes(p.answer) && !p.answer.includes(t) && !termRegex(t).test(p.sentence))
      .sort((a, b) => Math.abs(wordCount(a) - wordCount(p.answer)) - Math.abs(wordCount(b) - wordCount(p.answer)) || counts[b] - counts[a])
    const distractors: string[] = []
    for (const t of shuffle(candidates.slice(0, 8), random))
      if (distractors.length < 3 && !distractors.some(d => d.includes(t) || t.includes(d))) distractors.push(t)
    if (distractors.length === 3) {
      const options = shuffle([answer, ...distractors.map(display)], random)
      return { ...base, type: 'quiz', prompt: p.sentence.replace(termRegex(p.answer), BLANK), options, answerIndex: options.indexOf(answer) }
    }
    // Not enough believable wrong choices: ask it as identification instead.
  }
  return { ...base, type: 'identification', prompt: describeWithoutTerm(p.sentence, p.answer), answer }
}

/** Round-robin so every selected cell is represented before any gets a second question. */
function interleave(lists: StudyItem[][], max: number) {
  const out: StudyItem[] = []
  for (let round = 0; out.length < max && lists.some(l => l[round]); round++)
    for (const l of lists) if (l[round] && out.length < max) out.push(l[round])
  return out
}

export function makeQuestions(sources: QuizSource[], { kind = 'multiple-choice' as QuizKind, max = 15, perSource = 2, random = Math.random } = {}): StudyItem[] {
  if (kind === 'enumeration') {
    const seen = new Set<string>()
    return interleave(sources.map((source, si) => listsIn(source.text)
      .filter(l => { const k = l.items.join('|').toLowerCase(); return !seen.has(k) && !!seen.add(k) })
      .slice(0, perSource)
      .map((l, i): StudyItem => ({
        id: `q-${si}-${i}`, type: 'enumeration', prompt: `${capitalize(l.lead)} ${BLANK}.`, answers: l.items.map(display),
        explanation: l.sentence, citations: [citationFor(source)],
      }))), max)
  }
  const { picks, pool, counts } = pickTerms(sources, perSource)
  return interleave(picks.map(list => list.map((p, i) => buildTermItem(kind, p, `q-${p.si}-${i}`, pool, counts, random))), max)
}

/** A starting title from what the selected cells are about. */
export function suggestTitle(sources: QuizSource[]) {
  const counts = termCounts(sources.map(s => s.text).join('\n'), 3)
  const top = Object.keys(counts).slice(0, 2)
  return top.length ? `${top.map(capitalize).join(' & ')} quiz` : 'New quiz'
}
