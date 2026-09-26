// Turns a parsed request (lib/nlp.ts) into notebook cells: answers, reviewers, file lists, summaries, comparisons,
// topic lists and quiz starters. Everything is drawn from instructors' materials and cited. Pure functions.
import { logicalLines, splitSentences } from '@/lib/chunks'
import type { Library, MaterialInfo, Passage } from '@/lib/library'
import { parse, topicWords, type Intent, type Plan } from '@/lib/nlp'
import { listsIn } from '@/lib/quiz'
import type { ChatCell } from '@/lib/recents'
import { answer, excerptFor, expandedSearch, queryTerms, search, stem, type Index } from '@/lib/retrieval'
import { isContent, termCounts, words } from '@/lib/topics'
import { subjects } from '@/types'

type Cell = Omit<ChatCell, 'id'>
export type ReplyPart = { label: string; query: string; cells: Cell[] }
export type Reply = { intent: Intent; note?: string; parts: ReplyPart[]; autoQuiz?: boolean }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const passageCell = (p: Passage, excerpt: string): Cell => ({ kind: 'passage', passage: p, excerpt })

// ---- Scope: which files a request is about ----

function filesInScope(lib: Library, plan: Plan, scope: string | null): { files: MaterialInfo[]; dropped: string[] } {
  const dropped: string[] = []
  let subjectIds = plan.subjectIds
  // "machine learning" names both a subject and a topic. Only filter by the subject if it has files.
  if (subjectIds.length && !lib.materials.some(m => subjectIds.includes(m.subjectId))) {
    dropped.push(...subjectIds.map(id => subjects.find(s => s.id === id)?.code ?? id))
    subjectIds = []
  }
  let files = lib.materials.filter(m =>
    (!plan.owners.length || plan.owners.includes(m.ownerName)) &&
    (!subjectIds.length || subjectIds.includes(m.subjectId)) &&
    (!plan.formats.length || plan.formats.includes(m.format)) &&
    (!plan.since || Date.parse(m.createdAt) >= plan.since) &&
    (!scope || m.subjectId === scope))
  if (plan.recent) files = [...files].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
  return { files, dropped }
}

const FILE_WORDS = /(slides?|deck|pdfs?|files?|lectures?|handouts?|modules?|chapters?|documents?|presentations?|readings?|powerpoint|pptx|docx)/i

/**
 * A file the request names by title ("summarize the gradient descent slides"). Only when the student refers to a
 * file, or the topic is the whole title; otherwise "reviewer on overfitting" means the topic, not one file.
 */
function fileNamedBy(topic: string, files: MaterialInfo[], input: string): MaterialInfo | undefined {
  const want = topicWords(topic)
  if (!want.length) return undefined
  const refersToFile = FILE_WORDS.test(input)
  let best: MaterialInfo | undefined, bestScore = 0
  for (const m of files) {
    const title = [...new Set(words(`${m.title} ${m.fileName.replace(/\.[^.]+$/, '')}`).map(stem))]
    const hit = want.filter(w => title.includes(w)).length
    const score = hit / want.length
    const wholeTitle = topic.trim().toLowerCase() === m.title.trim().toLowerCase()
    if (hit && score >= 0.6 && (refersToFile || wholeTitle) && score > bestScore) { best = m; bestScore = score }
  }
  return best
}

/** How to name what a reviewer/summary covers. */
function aboutText(plan: Plan, files: MaterialInfo[]) {
  if (plan.topic) return plan.topic
  const subject = plan.subjectIds.map(id => subjects.find(s => s.id === id)).filter(Boolean).map(s => `${s!.code} ${s!.title}`)
  if (subject.length && files.some(f => plan.subjectIds.includes(f.subjectId))) return subject.join(' & ')
  if (plan.owners.length) return `everything ${plan.owners.join(' & ')} uploaded`
  return 'all uploaded materials'
}

const describeScope = (plan: Plan, files: MaterialInfo[]) => {
  const bits: string[] = []
  if (plan.owners.length) bits.push(`by ${plan.owners.join(' & ')}`)
  const codes = [...new Set(files.map(f => f.subjectCode).filter(Boolean))]
  if (plan.subjectIds.length && codes.length) bits.push(`in ${codes.join(', ')}`)
  if (plan.formats.length) bits.push(`(${plan.formats.map(f => f.toUpperCase()).join('/')} only)`)
  if (plan.since) bits.push('recently uploaded')
  if (plan.recent) bits.push('newest first')
  return bits.join(' ')
}

// ---- Building blocks ----

const passagesOf = (lib: Library, files: MaterialInfo[]) => {
  const ids = new Set(files.map(f => f.id))
  return lib.passages.filter(p => ids.has(p.materialId))
}

type Sentence = { text: string; passage: Passage; order: number }
function sentencesOf(passages: Passage[]): Sentence[] {
  const out: Sentence[] = []
  passages.forEach(p => logicalLines(p.text).flatMap(splitSentences).forEach(s => {
    const text = s.trim()
    if (text.length >= 30 && text.split(' ').length >= 5) out.push({ text, passage: p, order: out.length })
  }))
  return out
}

/** Extractive summary: sentences scored by how many of the text's key terms they carry, kept in reading order. */
function keySentences(passages: Passage[], n: number, focus: string[] = []): Sentence[] {
  const sentences = sentencesOf(passages)
  const counts = termCounts(passages.map(p => p.text).join('\n'), 40)
  const key = new Map(Object.entries(counts).map(([t, c]) => [t, c]))
  const scored = sentences.map(s => {
    const lower = s.text.toLowerCase()
    let score = 0
    for (const [t, c] of key) if (lower.includes(t)) score += Math.log(1 + c) * (t.includes(' ') ? 1.5 : 1)
    for (const f of focus) if (words(lower).map(stem).includes(f)) score += 3
    // Definitions and early sentences carry the main idea.
    if (/\b(is|are|refers to|means|happens when)\b/.test(lower)) score *= 1.3
    return { s, score: score / Math.sqrt(s.text.split(' ').length) }
  })
  const picked = scored.sort((a, b) => b.score - a.score).slice(0, n).map(x => x.s)
  return picked.sort((a, b) => a.order - b.order)
}

const DEFINITION = (term: string) => new RegExp(`^(the |an? )?${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*,?\\s+(is|are|refers to|means|happens|occurs|describes|estimates|measures|controls|minimizes|reduces|adds|uses|updates|helps)\\b`, 'i')

/** Key terms with the sentence that defines them. */
function glossary(passages: Passage[], max = 8): Cell[] {
  const sentences = sentencesOf(passages)
  const terms = Object.keys(termCounts(passages.map(p => p.text).join('\n'), 40)).filter(t => t.length >= 4)
  const cells: Cell[] = []
  for (const term of terms) {
    if (cells.length >= max) break
    const def = sentences.find(s => DEFINITION(term).test(s.text))
    if (def && !cells.some(c => c.excerpt === def.text)) cells.push({ kind: 'term', heading: cap(term), excerpt: def.text, passage: def.passage })
  }
  return cells
}

function lists(passages: Passage[], max = 5): Cell[] {
  const cells: Cell[] = []
  for (const p of passages) for (const l of listsIn(p.text)) {
    if (cells.length >= max || cells.some(c => c.excerpt === l.items.join('\n'))) continue
    // Slide lists are headed by the slide's title.
    const slide = l.lead.match(/^Under “(.+)”, the material lists$/)
    cells.push({ kind: 'list', heading: cap(slide ? slide[1] : l.lead.replace(/[:,]$/, '')), excerpt: l.items.join('\n'), passage: p })
  }
  return cells
}

/** The most central passages of a file: the ones sharing the most of its key terms. */
function mainPassages(passages: Passage[], n: number): Passage[] {
  const counts = termCounts(passages.map(p => p.text).join('\n'), 30)
  const score = (p: Passage) => { const l = p.text.toLowerCase(); return Object.entries(counts).reduce((a, [t, c]) => a + (l.includes(t) ? Math.log(1 + c) : 0), 0) }
  return [...passages].sort((a, b) => score(b) - score(a)).slice(0, n).sort((a, b) => passages.indexOf(a) - passages.indexOf(b))
}

const materialCell = (lib: Library, m: MaterialInfo): Cell => {
  const first = lib.passages.find(p => p.materialId === m.id)!
  return {
    kind: 'material', heading: m.title, passage: first,
    excerpt: m.excerpt.length > 260 ? m.excerpt.slice(0, 257).trimEnd() + '…' : m.excerpt,
    meta: { topics: Object.keys(m.terms).slice(0, 5), pages: m.pages, uploadedAt: m.createdAt },
  }
}

const notFound = (label: string, query = ''): ReplyPart => ({ label, query, cells: [] })

// ---- Intents ----

function browse(lib: Library, plan: Plan, files: MaterialInfo[]): Reply {
  let shown = files
  if (plan.topic) {
    const want = topicWords(plan.topic)
    const score = (m: MaterialInfo) => {
      const hay = new Set(words(`${m.title} ${Object.keys(m.terms).join(' ')}`).map(stem))
      return want.filter(w => hay.has(w)).length
    }
    shown = files.map(m => ({ m, s: score(m) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.m)
  } else if (!plan.recent) shown = [...files].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const scope = describeScope(plan, shown)
  const label = `Files${plan.topic ? ` about ${plan.topic}` : ''}${scope ? ` ${scope}` : ''}`
  if (!shown.length) {
    const who = [...new Set(lib.materials.map(m => m.ownerName))]
    return { intent: 'browse', parts: [notFound(label)], note: `No files match. Instructors with uploads: ${who.join(', ') || 'none yet'}.` }
  }
  return { intent: 'browse', note: `${plural(shown.length, 'file')} ${scope || 'uploaded by your instructors'}.`, parts: [{ label, query: plan.topic, cells: shown.map(m => materialCell(lib, m)) }] }
}

function reviewer(lib: Library, index: Index, plan: Plan, files: MaterialInfo[], input: string): Reply {
  const named = plan.topic ? fileNamedBy(plan.topic, files, input) : undefined
  let pool: Passage[]
  let expansion: string[] = []
  if (plan.topic && !named) {
    const found = expandedSearch(index, plan.topic, { materialIds: new Set(files.map(f => f.id)), limit: 14, minCoverage: 0.34 })
    pool = found.hits.map(h => h.passage)
    expansion = found.expansion
  } else {
    pool = passagesOf(lib, named ? [named] : files).slice(0, 60)
  }
  const about = named ? named.title : aboutText(plan, files)
  if (!pool.length) return { intent: 'reviewer', parts: [notFound(`Reviewer: ${about}`, plan.topic)], note: `Nothing in the uploaded materials covers “${about}” yet.` }

  const byFile = new Map<string, Passage[]>()
  for (const p of pool) byFile.set(p.materialId, [...(byFile.get(p.materialId) ?? []), p])
  const terms = queryTerms([plan.topic, ...expansion].join(' '))
  const parts: ReplyPart[] = []
  const gloss = glossary(pool)
  if (gloss.length) parts.push({ label: 'Key terms', query: plan.topic, cells: gloss })
  const lst = lists(pool)
  if (lst.length) parts.push({ label: 'Lists to remember', query: plan.topic, cells: lst })
  for (const [id, ps] of [...byFile].slice(0, 4)) {
    const title = lib.materials.find(m => m.id === id)?.title ?? ps[0].title
    const main = mainPassages(ps, 3).map(p => passageCell(p, excerptFor(p.text, terms)))
    const fresh = main.filter(c => !parts.some(pt => pt.cells.some(x => x.excerpt === c.excerpt)))
    if (fresh.length) parts.push({ label: `Main points · ${title}`, query: [plan.topic, ...expansion].join(' '), cells: fresh })
  }
  const cellCount = parts.reduce((a, p) => a + p.cells.length, 0)
  return {
    intent: 'reviewer', parts,
    note: `Reviewer on ${about}: ${plural(gloss.length, 'key term')}, ${plural(lst.length, 'list')}, ${plural(cellCount - gloss.length - lst.length, 'main point')} from ${plural(byFile.size, 'file')}.${expansion.length ? ` Also covered related terms: ${expansion.slice(0, 4).join(', ')}.` : ''} Use Create quiz below to test yourself on it.`,
  }
}

function summarize(lib: Library, index: Index, plan: Plan, files: MaterialInfo[], input: string): Reply {
  const named = fileNamedBy(plan.topic, files, input) ?? (!plan.topic && files.length === 1 ? files[0] : undefined)
  if (named) {
    const picks = keySentences(passagesOf(lib, [named]), 6)
    return { intent: 'summarize', note: `Summary of ${named.title}: the ${plural(picks.length, 'sentence')} that carry its main ideas, in reading order.`,
      parts: [{ label: `Summary · ${named.title}`, query: Object.keys(named.terms).slice(0, 6).join(' '), cells: picks.map(s => passageCell(s.passage, s.text)) }] }
  }
  const found = expandedSearch(index, plan.topic, { materialIds: new Set(files.map(f => f.id)), limit: 10, minCoverage: 0.5 })
  if (!found.hits.length) return { intent: 'summarize', parts: [notFound(`Summary: ${plan.topic}`, plan.topic)], note: `Nothing in the uploaded materials covers “${plan.topic}” yet.` }
  const picks = keySentences(found.hits.map(h => h.passage), 6, queryTerms(plan.topic))
  return { intent: 'summarize', note: `Summary of “${plan.topic}” across ${plural(new Set(picks.map(p => p.passage.materialId)).size, 'file')}.`,
    parts: [{ label: `Summary · ${cap(plan.topic)}`, query: plan.topic, cells: picks.map(s => passageCell(s.passage, s.text)) }] }
}

function compare(lib: Library, index: Index, plan: Plan, files: MaterialInfo[]): Reply {
  const [a, b] = plan.compare!
  const ids = new Set(files.map(f => f.id))
  const side = (x: string) => search(index, x, { materialIds: ids, limit: 2 })
  const ha = side(a), hb = side(b)
  const vocabOf = (hs: typeof ha) => new Set(words(hs.map(h => h.excerpt).join(' ')).filter(w => w.length >= 4 && isContent(w)))
  const inB = vocabOf(hb), asked = new Set(words(`${a} ${b}`))
  const shared = [...vocabOf(ha)].filter(w => inB.has(w) && !asked.has(w)).slice(0, 8)
  const parts: ReplyPart[] = [
    { label: cap(a), query: a, cells: ha.map(h => passageCell(h.passage, h.excerpt)) },
    { label: cap(b), query: b, cells: hb.map(h => passageCell(h.passage, h.excerpt)) },
  ]
  return { intent: 'compare', parts,
    note: ha.length && hb.length ? `${cap(a)} vs ${b}, side by side.${shared.length ? ` Both passages talk about: ${shared.join(', ')}.` : ''}` : `Only part of this comparison is covered by the uploaded materials.` }
}

function topics(lib: Library, plan: Plan, files: MaterialInfo[]): Reply {
  if (!files.length) return { intent: 'topics', parts: [notFound('Topics')], note: 'No files match that.' }
  const total = new Map<string, number>()
  for (const f of files) for (const [t, c] of Object.entries(f.terms)) total.set(t, (total.get(t) ?? 0) + c)
  // Prefer phrases; drop single words already inside a listed phrase.
  const ranked = [...total].sort((x, y) => y[1] * (y[0].includes(' ') ? 1.5 : 1) - x[1] * (x[0].includes(' ') ? 1.5 : 1)).map(([t]) => t)
  const picked: string[] = []
  for (const t of ranked) if (picked.length < 15 && !picked.some(p => p.includes(t) || t.includes(p))) picked.push(t)
  const scope = describeScope(plan, files)
  return { intent: 'topics', note: `Main topics across ${plural(files.length, 'file')}${scope ? ` ${scope}` : ''}. Ask about any of them.`,
    parts: [{ label: `Topics${scope ? ` ${scope}` : ''}`, query: picked.join(' '), cells: [{ kind: 'list', heading: 'Topics covered', excerpt: picked.map(cap).join('\n'), passage: lib.passages.find(p => p.materialId === files[0].id)! }] }] }
}

function ask(index: Index, input: string, plan: Plan, files: MaterialInfo[], scope: string | null, restrict: boolean): Reply {
  // Typos are fixed in the question itself so every part benefits.
  let question = input
  for (const c of plan.corrections) question = question.replace(new RegExp(`\\b${c.from}\\b`, 'i'), c.to)
  const parts = answer(index, question, scope, restrict ? new Set(files.map(f => f.id)) : undefined).map(p => ({
    label: p.label, query: p.query, cells: p.hits.map(h => passageCell(h.passage, h.excerpt)),
  }))
  return { intent: 'ask', parts }
}

// ---- Entry point ----

export function respond(input: string, lib: Library, index: Index, scope: string | null = null): Reply {
  const owners = [...new Set(lib.materials.map(m => m.ownerName))]
  const plan = parse(input, { owners, subjects, vocab: index.df })
  const { files, dropped } = filesInScope(lib, plan, scope)
  // "a reviewer regarding machine learning" where Machine Learning is a subject with files: cover the subject.
  const subjectTitles = plan.subjectIds.flatMap(id => topicWords(subjects.find(s => s.id === id)?.title ?? ''))
  if (plan.topic && !dropped.length && subjectTitles.length && topicWords(plan.topic).every(w => subjectTitles.includes(w))) plan.topic = ''
  const restrict = !!(plan.owners.length || plan.formats.length || plan.since || plan.recent || (plan.subjectIds.length && !dropped.length))
  const typo = plan.corrections.length ? `Showing results for ${plan.corrections.map(c => `“${c.to}”`).join(', ')} (you typed ${plan.corrections.map(c => `“${c.from}”`).join(', ')}). ` : ''

  let reply: Reply
  if (plan.intent === 'browse') reply = browse(lib, plan, files)
  else if (plan.intent === 'reviewer') reply = reviewer(lib, index, plan, files, input)
  else if (plan.intent === 'summarize' && (plan.topic || files.length === 1)) reply = summarize(lib, index, plan, files, input)
  else if (plan.intent === 'compare' && plan.compare) reply = compare(lib, index, plan, files)
  else if (plan.intent === 'topics') reply = topics(lib, plan, files)
  else if (plan.intent === 'quiz') {
    const named = plan.topic ? fileNamedBy(plan.topic, files, input) : undefined
    const base = named || !plan.topic
      ? { intent: 'quiz' as const, parts: [{ label: `Quiz material · ${named?.title ?? (describeScope(plan, files) || 'all files')}`, query: '', cells: mainPassages(passagesOf(lib, named ? [named] : files), 6).map(p => passageCell(p, excerptFor(p.text, []))) }] }
      : { ...ask(index, plan.topic, plan, files, scope, restrict), intent: 'quiz' as const }
    const n = base.parts.reduce((a, p) => a + p.cells.length, 0)
    reply = { ...base, autoQuiz: n > 0, note: n ? `Found ${plural(n, 'cell')} to quiz you on. Pick a quiz type and title to start.` : `Nothing in the uploaded materials covers “${plan.topic}” yet.` }
  } else reply = ask(index, input, plan, files, scope, restrict)

  if (dropped.length && reply.note) reply.note += ` (No files are filed under ${dropped.join(', ')} yet, so all subjects were searched.)`
  return { ...reply, note: typo + (reply.note ?? '') || undefined }
}
