// Understands what a student is asking for, not just which words they used. Rule-based NLP, all in the browser:
// intent detection, entity extraction (instructor, subject, file type, time), topic extraction and typo correction.
// Pure functions: no DOM, no storage.
import type { Format } from '@/lib/extract'
import { closestTerm, stem } from '@/lib/retrieval'
import { isContent, words } from '@/lib/topics'
import type { Subject } from '@/types'

export type Intent = 'ask' | 'reviewer' | 'browse' | 'summarize' | 'compare' | 'quiz' | 'topics'

export type Plan = {
  intent: Intent
  /** What it's about, with request words, names and filters taken out. May be empty ("everything prof X uploaded"). */
  topic: string
  owners: string[]
  subjectIds: string[]
  formats: Format[]
  /** Only files uploaded at or after this time. */
  since?: number
  /** "latest", "newest", "recent" */
  recent: boolean
  compare?: [string, string]
  corrections: { from: string; to: string }[]
}

// ---- Intent ----

const INTENTS: [Intent, RegExp][] = [
  ['quiz', /\b(quiz|test|drill) me\b|\b(make|create|generate|give me|prepare)\b.{0,40}\b(quiz|practice (questions|test)|mock (exam|test))\b|\bquiz (on|about|regarding)\b/],
  ['reviewer', /\b(reviewers?|review(er)? notes?|study (guide|notes)|cheat ?sheet|notes? (on|about|for|regarding|of))\b|\b(help me )?review\b(?! (the|my) (quiz|answers?))/],
  ['compare', /\b(compare|comparison|difference|differences|differentiate|distinguish|contrast|versus|vs\.?)\b/],
  ['summarize', /\b(summari[sz]e|summary|tl;?dr|gist|overview|in a nutshell)\b|\bwhat('?s| is) (this|the|that) (file|lecture|pdf|slides?|module|handout|document|chapter)\b.{0,30}\babout\b/],
  ['topics', /\b(what|which) (topics|lessons|chapters|concepts)\b|\btopics (covered|in|of|for|from)\b|\bwhat does .{0,40} cover\b/],
  ['browse', /\b(everything|all|list|show|give me|send me|find|what)\b.{0,60}\b(upload(ed|s)?|posted|shared|files?|materials?|slides|pdfs?|documents|handouts|modules|lectures|presentations)\b|\bwhat did .{0,40}\b(upload|post|share)\b/],
]

export function detectIntent(text: string): Intent {
  const t = text.toLowerCase()
  return INTENTS.find(([, re]) => re.test(t))?.[0] ?? 'ask'
}

// ---- Entities ----

const TITLES = new Set('prof professor profs sir maam ma\'am mam madam dr doc doctor teacher instructor engr engineer mr mrs ms miss'.split(' '))
const OWNER_CONTEXT = /\b(upload(ed|s)?|posted|shared|by|from|of|made|handout|files?|materials?)\b/

const norm = (s: string) => s.toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9'\s-]/g, ' ').replace(/\s+/g, ' ').trim()

function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i
    for (let j = 1; j <= b.length; j++) { const cur = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur }
  }
  return row[b.length]
}

/**
 * Instructors named in the text. A name counts if it's given in full, follows a title ("prof peter", "ma'am cruz"),
 * or appears near upload words and isn't a course term (so a topic that happens to match a surname isn't taken).
 */
export function findOwners(text: string, owners: string[], vocab: Map<string, number>): { names: string[]; used: Set<number> } {
  const tokens = norm(text).split(' ')
  const hasContext = OWNER_CONTEXT.test(norm(text))
  const names: string[] = []
  const used = new Set<number>()
  for (const owner of owners) {
    const parts = norm(owner).split(/[\s,]+/).filter(p => p.length >= 2 && !TITLES.has(p))
    const hits = tokens.map((t, i) => ({ t, i })).filter(({ t }) => t.length >= 3 && parts.some(p => p === t || (p.length >= 5 && editDistance(p, t) <= 1)))
    if (!hits.length) continue
    const titled = hits.some(({ i }) => i > 0 && TITLES.has(tokens[i - 1]))
    const full = new Set(hits.map(h => h.t)).size >= Math.min(2, parts.length)
    const notATopic = hits.every(({ t }) => !vocab.has(stem(t)))
    if (titled || full || (hasContext && notATopic)) {
      names.push(owner)
      for (const { i } of hits) { used.add(i); if (i > 0 && TITLES.has(tokens[i - 1])) used.add(i - 1) }
    }
  }
  return { names, used }
}

export function findSubjects(text: string, subjects: Subject[]): Subject[] {
  const t = norm(text)
  const found = new Map<string, Subject>()
  for (const m of t.matchAll(/\b([a-z]{2,4})\s*-?\s*(\d{3})\b/g)) {
    const code = `${m[1].toUpperCase()} ${m[2]}`
    const s = subjects.find(x => x.code === code)
    if (s) found.set(s.id, s)
  }
  for (const s of subjects) if (t.includes(s.title.toLowerCase())) found.set(s.id, s)
  return [...found.values()]
}

const FORMAT_WORDS: [Format, RegExp][] = [
  ['pdf', /\bpdfs?\b/],
  ['pptx', /\b(slides?|slide ?decks?|power ?points?|pptx?|presentations?)\b/],
  ['docx', /\b(word (files?|docs?|documents?)|docx?)\b/],
]
export const findFormats = (text: string): Format[] => FORMAT_WORDS.filter(([, re]) => re.test(text.toLowerCase())).map(([f]) => f)

export function findTime(text: string, now = new Date()): { since?: number; recent: boolean } {
  const t = text.toLowerCase()
  const day = 24 * 60 * 60 * 1000
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  if (/\btoday\b/.test(t)) return { since: start.getTime(), recent: false }
  if (/\byesterday\b/.test(t)) return { since: start.getTime() - day, recent: false }
  if (/\b(this|past|last) week\b/.test(t)) return { since: now.getTime() - 7 * day, recent: false }
  if (/\b(this|past|last) month\b/.test(t)) return { since: now.getTime() - 31 * day, recent: false }
  return { recent: /\b(latest|newest|recent(ly)?|new)\b/.test(t) }
}

// ---- Topic ----

// Words that say what to do or which files, not what it's about.
const REQUEST_WORDS = new Set(`make create generate give send show list find get prepare build write want need help please pls kindly could would will can you me
my i im i'm us we our reviewer reviewers review notes note study guide cheat sheet summarize summarise summary tldr gist overview nutshell quiz test drill practice
questions question mock exam compare comparison difference differences differentiate distinguish contrast versus vs everything all every files file materials
material slides slide deck decks pdf pdfs documents document docx doc word powerpoint pptx ppt presentation presentations handout handouts module modules
lecture lectures upload uploaded uploads posted shared share regarding about on of for from by in the a an and or that which what whats what's is are was
were did does do between topics topic lessons lesson chapters chapter concepts concept covered cover covers latest newest recent recently new today yesterday this
past last week month tell explain describe define thing things stuff everything anything something related`.split(/\s+/))

/** What's left after removing request words, names, subject codes, titles and filters: the actual topic. */
export function extractTopic(text: string, drop: Set<number>): string {
  const tokens = norm(text).split(' ')
  const skip = new Set(drop)
  tokens.forEach((t, i) => {
    // Subject codes: "cs 211", "cs211"
    if (/^\d{3}$/.test(t)) { skip.add(i); if (i > 0 && /^[a-z]{2,4}$/.test(tokens[i - 1])) skip.add(i - 1) }
    if (/^[a-z]{2,4}\d{3}$/.test(t)) skip.add(i)
  })
  return tokens.filter((t, i) => !skip.has(i) && !TITLES.has(t) && !REQUEST_WORDS.has(t)).join(' ').trim()
}

export function correctTopic(topic: string, vocab: Map<string, number>) {
  const corrections: { from: string; to: string }[] = []
  const fixed = topic.split(' ').map(w => {
    if (!isContent(w)) return w
    const to = closestTerm(w, vocab)
    if (to && to !== stem(w)) { corrections.push({ from: w, to }); return to }
    return w
  }).join(' ')
  return { topic: fixed, corrections }
}

const COMPARE = [
  /(?:compare|comparison (?:of|between)|contrast|differentiate|distinguish)\s+(?:between\s+)?(.+?)\s+(?:and|with|to|from|vs\.?|versus)\s+(.+)/,
  /differences?\s+(?:between|of)\s+(.+?)\s+(?:and|vs\.?|versus)\s+(.+)/,
  /(.+?)\s+(?:vs\.?|versus)\s+(.+)/,
  /how (?:is|are|does|do)\s+(.+?)\s+differ(?:ent)? (?:from|to|with)\s+(.+)/,
]
export function findComparison(text: string): [string, string] | undefined {
  const t = norm(text).replace(/\?/g, '')
  for (const re of COMPARE) {
    const m = t.match(re)
    if (m) {
      const clean = (s: string) => s.split(' ').filter(w => !REQUEST_WORDS.has(w) || w === 'and').join(' ').replace(/^(and|the)\s+|\s+(and|the)$/g, '').trim()
      const a = clean(m[1]), b = clean(m[2])
      if (a && b && a !== b) return [a, b]
    }
  }
  return undefined
}

// ---- Putting it together ----

const POLITE = /^(hey|hi|hello|yo|scribe|please|pls|kindly)[,!.\s]+|^(can|could|would|will) you( please)?\s+|^i (want|need) (you )?to\s+|^help me( to)?\s+/i

export function parse(input: string, ctx: { owners: string[]; subjects: Subject[]; vocab: Map<string, number>; now?: Date; self?: string }): Plan {
  let text = input.trim()
  for (let i = 0; i < 3; i++) text = text.replace(POLITE, '')
  const intent = detectIntent(text)
  const { names, used } = findOwners(text, ctx.owners, ctx.vocab)
  // An instructor asking about "my files" / "what I uploaded" means themselves.
  if (ctx.self && !names.length && /\b(my|i|i've|ive)\b.{0,40}\b(upload(ed|s)?|files?|materials?|slides|pdfs?|handouts|lectures)\b|\bmy (upload|file|material|slide|lecture)/i.test(text)) names.push(ctx.self)
  const subjects = findSubjects(text, ctx.subjects)
  const formats = findFormats(text)
  const { since, recent } = findTime(text, ctx.now)
  const compare = intent === 'compare' ? findComparison(text) : undefined
  const raw = extractTopic(text, used)
  const { topic, corrections } = correctTopic(raw, ctx.vocab)
  return { intent, topic, owners: names, subjectIds: subjects.map(s => s.id), formats, since, recent, compare, corrections }
}

/** Content words of a topic, for matching against file titles and terms. */
export const topicWords = (topic: string) => words(topic).filter(isContent).map(stem)
