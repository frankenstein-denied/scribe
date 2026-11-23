import type { RecentChat } from '@/lib/recents'
import type { SavedStudySet } from '@/lib/studysets'
import type { StudyItem } from '@/types'

// Career match: scores CICT career paths from a student's own searches (Ask SCRIBE turns), quizzes taken and quiz
// results. Pure functions, no Firebase.

export const TOPICS: { name: string; keywords: string[] }[] = [
  { name: 'Machine learning', keywords: ['machine learning', 'regression', 'classification', 'neural network', 'deep learning', 'clustering', 'k-means', 'decision tree', 'random forest', 'gradient descent', 'overfitting', 'supervised learning', 'unsupervised learning', 'training data', 'feature engineering'] },
  { name: 'Data & statistics', keywords: ['statistics', 'statistical', 'probability', 'arithmetic mean', 'median', 'standard deviation', 'variance', 'hypothesis', 'correlation', 'data analysis', 'data preprocessing', 'data cleaning', 'dataset', 'sampling', 'distribution'] },
  { name: 'Algorithms', keywords: ['algorithm', 'sorting', 'bubble sort', 'merge sort', 'quicksort', 'binary search', 'big o', 'time complexity', 'recursion', 'dynamic programming', 'graph traversal', 'linked list', 'stack', 'queue', 'data structure'] },
  { name: 'Programming', keywords: ['programming', 'python', 'java', 'javascript', 'function', 'variable', 'loop', 'array', 'object-oriented', 'inheritance', 'compiler', 'debugging', 'pointer', 'syntax'] },
  { name: 'Databases & SQL', keywords: ['database', 'sql', 'query', 'join', 'normalization', 'primary key', 'foreign key', 'relational', 'table', 'schema', 'index', 'transaction', 'nosql', 'entity relationship', 'erd'] },
  { name: 'Web development', keywords: ['web development', 'html', 'css', 'react', 'frontend', 'front-end', 'backend', 'back-end', 'http', 'rest api', 'api', 'framework', 'responsive', 'web server', 'browser'] },
  { name: 'Operating systems', keywords: ['operating system', 'process management', 'thread', 'scheduling', 'deadlock', 'semaphore', 'memory management', 'virtual memory', 'paging', 'file system', 'kernel', 'cpu scheduling', 'linux', 'mutex', 'context switch'] },
  { name: 'Networks & security', keywords: ['network', 'networking', 'tcp', 'ip address', 'dns', 'router', 'firewall', 'encryption', 'cryptography', 'cybersecurity', 'security', 'malware', 'authentication', 'osi model', 'vpn'] },
]

export const CAREERS: { name: string; track: string; need: number[] }[] = [
  { name: 'Data Scientist', track: 'Data Analytics track', need: [3, 3, 2, 2, 2, 0, 0, 0] },
  { name: 'Machine Learning Engineer', track: 'Intelligent Systems track', need: [3, 2, 2, 3, 1, 0, 1, 0] },
  { name: 'Data Analyst', track: 'Data Analytics track', need: [1, 3, 1, 1, 3, 0, 0, 0] },
  { name: 'Software Engineer', track: 'BSCS', need: [1, 1, 3, 3, 2, 2, 1, 1] },
  { name: 'Systems Administrator', track: 'BSIT', need: [0, 0, 1, 1, 1, 0, 3, 3] },
  { name: 'Database Administrator', track: 'BSIT', need: [0, 1, 1, 1, 3, 0, 2, 1] },
  { name: 'Web Developer', track: 'BSIT', need: [0, 0, 1, 3, 2, 3, 0, 1] },
  { name: 'Cybersecurity Analyst', track: 'BSIT', need: [0, 1, 1, 1, 1, 1, 2, 3] },
]

export const NEXT_STEP: Record<string, string> = {
  'Machine learning': 'Quiz yourself on neural networks',
  'Data & statistics': 'Quiz yourself on data preprocessing',
  'Databases & SQL': 'Ask SCRIBE about SQL joins',
  'Programming': 'Make a reviewer on Python basics',
  'Algorithms': 'Quiz yourself on sorting algorithms',
  'Operating systems': 'Retake your Operating systems quiz',
  'Networks & security': 'Ask SCRIBE about network security',
  'Web development': 'Ask SCRIBE about web frameworks',
}

export const NEED_LABEL = ['', 'Some', 'Important', 'Core']

export type Signal = 'searches' | 'quizzes' | 'results'
export type Use = Record<Signal, boolean>
export const WEIGHTS: Record<Signal, number> = { searches: 0.3, quizzes: 0.3, results: 0.4 }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Word boundaries that also work next to punctuation; a trailing "s" is allowed so plurals match.
const PATTERNS = TOPICS.map(t => new RegExp(`(?:^|[^a-z0-9])(?:${t.keywords.map(escape).join('|')})(?:s|es)?(?![a-z0-9])`, 'i'))

/** Indexes (into TOPICS) of every topic whose keywords appear in the text. */
export function topicsOf(text: string): number[] {
  const out: number[] = []
  PATTERNS.forEach((re, i) => { if (re.test(text)) out.push(i) })
  return out
}

export type TopicEvidence = { searches: number; quizzes: number; avgScore: number | null }
export type EvidenceSummary = { topics: TopicEvidence[]; searches: number; quizzes: number; avgScore: number | null }

const itemText = (it: StudyItem) => [it.heading, it.body, it.front, it.back, it.prompt, it.answer, ...(it.options ?? []), ...(it.answers ?? [])].filter(Boolean).join(' ')
const turnText = (t: RecentChat['turns'][number]) => [t.question, ...t.parts.flatMap(p => p.cells.map(c => c.excerpt))].join(' ')
const since = (iso: string, from?: Date) => !from || new Date(iso).getTime() >= from.getTime()

export function evidence(chats: RecentChat[], sets: SavedStudySet[], from?: Date): EvidenceSummary {
  const searches = TOPICS.map(() => 0)
  const quizzes = TOPICS.map(() => 0)
  const scores: number[][] = TOPICS.map(() => [])
  let nSearches = 0
  for (const c of chats) {
    if (!since(c.updatedAt, from)) continue
    for (const t of c.turns) { nSearches++; topicsOf(turnText(t)).forEach(i => { searches[i]++ }) }
  }
  const all: number[] = []
  let nQuizzes = 0
  for (const s of sets) {
    if (!(s.attempts > 0) || !since(s.createdAt, from)) continue
    nQuizzes++
    const pct = s.lastScore && s.lastScore.total ? (s.lastScore.correct / s.lastScore.total) * 100 : null
    if (pct != null) all.push(pct)
    topicsOf([s.title, ...s.items.map(itemText)].join(' ')).forEach(i => { quizzes[i]++; if (pct != null) scores[i].push(pct) })
  }
  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
  return {
    topics: TOPICS.map((_, i) => ({ searches: searches[i], quizzes: quizzes[i], avgScore: mean(scores[i]) })),
    searches: nSearches, quizzes: nQuizzes, avgScore: mean(all),
  }
}

export type Strength = { score: number; parts: Record<Signal, number>; searches: number; quizzes: number; avgScore: number | null }

/** Per-topic strength (0–100): searches and quizzes relative to the busiest topic, results as score/100, weighted by the enabled signals. */
export function strengths(ev: TopicEvidence[], use: Use): Strength[] {
  const maxS = Math.max(1, ...ev.map(e => e.searches)), maxQ = Math.max(1, ...ev.map(e => e.quizzes))
  const on = (Object.keys(WEIGHTS) as Signal[]).filter(k => use[k])
  const wsum = on.reduce((a, k) => a + WEIGHTS[k], 0) || 1
  return ev.map(e => {
    const parts = { searches: e.searches / maxS, quizzes: e.quizzes / maxQ, results: e.avgScore == null ? 0 : e.avgScore / 100 }
    const score = on.reduce((a, k) => a + WEIGHTS[k] * parts[k], 0) / wsum
    return { score: Math.round(score * 100), parts, searches: e.searches, quizzes: e.quizzes, avgScore: e.avgScore }
  })
}

export type CareerMatch = { name: string; track: string; need: number[]; pct: number; best: number; weakest: number; mix: Record<Signal, number> }

export function matches(str: Strength[], use: Use): CareerMatch[] {
  const on = (Object.keys(WEIGHTS) as Signal[]).filter(k => use[k])
  return CAREERS.map(({ name, track, need }) => {
    const total = need.reduce((a, b) => a + b, 0)
    const contrib = need.map((n, i) => (n / total) * str[i].score)
    const pct = Math.round(contrib.reduce((a, b) => a + b, 0))
    let best = 0, weakest = 0
    need.forEach((n, i) => {
      if (contrib[i] > contrib[best]) best = i
      if (n * (100 - str[i].score) > need[weakest] * (100 - str[weakest].score)) weakest = i
    })
    const tot: Record<Signal, number> = { searches: 0, quizzes: 0, results: 0 }
    need.forEach((n, i) => on.forEach(k => { tot[k] += n * WEIGHTS[k] * str[i].parts[k] }))
    const sum = tot.searches + tot.quizzes + tot.results || 1
    return { name, track, need, pct, best, weakest, mix: { searches: tot.searches / sum, quizzes: tot.quizzes / sum, results: tot.results / sum } }
  })
}
