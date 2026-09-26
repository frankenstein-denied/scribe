// The student's "2nd brain": every study session and quiz as a node, linked through the instructor files they came
// from, plus the numbers behind the motivation panel. Pure functions: no DOM, no storage.
import type { ChatTurn, RecentChat } from '@/lib/recents'
import type { Attempt, SavedStudySet } from '@/lib/studysets'

/** A quiz counts as passed at 75%, the usual passing mark. */
export const PASS_MARK = 0.75

export type QuizStatus = 'passed' | 'retook' | 'failed' | 'untaken'
export const STATUS_LABEL: Record<QuizStatus, string> = {
  passed: 'Passed on the first try', retook: 'Passed after a retake', failed: 'Not passed yet', untaken: 'Not taken yet',
}

export const passed = (a: Attempt) => a.total > 0 && a.correct / a.total >= PASS_MARK
export const attemptsOf = (s: SavedStudySet): Attempt[] => (s.history?.length ? s.history : s.lastScore ? [s.lastScore] : [])

/** Green: passed first try. Yellow: passed, but only after failing. Red: latest take failed. */
export function quizStatus(s: SavedStudySet): QuizStatus {
  const takes = attemptsOf(s)
  if (!takes.length) return 'untaken'
  if (!passed(takes[takes.length - 1])) return 'failed'
  return takes.slice(0, -1).some(a => !passed(a)) ? 'retook' : 'passed'
}

export type Source = { id: string; title: string; subjectCode: string; profName: string }

export type BrainNode =
  | { id: string; kind: 'session'; label: string; at: string; questions: number; sources: string[]; chatId: string | null; current: boolean }
  | { id: string; kind: 'quiz'; label: string; at: string; status: QuizStatus; set: SavedStudySet; sources: string[]; sessionId: string | null }
  | { id: string; kind: 'source'; label: string; source: Source }

export type BrainLink = { source: string; target: string; kind: 'made-from' | 'uses' | 'shares'; weight: number }

export const sessionNodeId = (chatId: string) => `session:${chatId}`
export const quizNodeId = (setId: string) => `quiz:${setId}`
export const sourceNodeId = (materialId: string) => `source:${materialId}`

function sourcesOfTurns(turns: ChatTurn[], into: Map<string, Source>) {
  const ids = new Set<string>()
  for (const t of turns) for (const p of t.parts) for (const c of p.cells) {
    const m = c.passage
    ids.add(m.materialId)
    if (!into.has(m.materialId)) into.set(m.materialId, { id: m.materialId, title: m.title, subjectCode: m.subjectCode, profName: m.profName })
  }
  return [...ids]
}

function sourcesOfSet(s: SavedStudySet, into: Map<string, Source>) {
  const ids = new Set<string>()
  for (const item of s.items) for (const c of item.citations ?? []) {
    ids.add(c.materialId)
    if (!into.has(c.materialId)) into.set(c.materialId, { id: c.materialId, title: c.materialTitle, subjectCode: c.subjectCode, profName: c.profName })
  }
  return [...ids]
}

export type BrainInput = { chats: RecentChat[]; current: { id: string | null; turns: ChatTurn[] }; sets: SavedStudySet[] }

/**
 * With `showSources`, sessions and quizzes hang off the files they used (hub nodes). Without, anything that shares a
 * file is linked directly. Either way, a quiz is linked to the session it was made from.
 */
export function buildBrain({ chats, current, sets }: BrainInput, { showSources }: { showSources: boolean }) {
  const sources = new Map<string, Source>()
  const nodes: BrainNode[] = []

  // The open conversation replaces its saved copy (it may have newer questions).
  const sessions = chats.filter(c => c.id !== current.id).map(c => ({ chatId: c.id as string | null, title: c.title, at: c.updatedAt, turns: c.turns, current: false }))
  if (current.turns.length) sessions.unshift({ chatId: current.id, title: current.turns[0].question, at: new Date().toISOString(), turns: current.turns, current: true })
  for (const s of sessions) {
    nodes.push({ id: sessionNodeId(s.chatId ?? 'current'), kind: 'session', label: s.title, at: s.at, questions: s.turns.length, sources: sourcesOfTurns(s.turns, sources), chatId: s.chatId, current: s.current })
  }
  const sessionIds = new Set(nodes.map(n => n.id))
  for (const set of sets) {
    const sessionId = set.sourceChatId && sessionIds.has(sessionNodeId(set.sourceChatId)) ? sessionNodeId(set.sourceChatId) : null
    nodes.push({ id: quizNodeId(set.id), kind: 'quiz', label: set.title, at: set.createdAt, status: quizStatus(set), set, sources: sourcesOfSet(set, sources), sessionId })
  }

  const links: BrainLink[] = []
  const items = nodes.filter((n): n is Exclude<BrainNode, { kind: 'source' }> => n.kind !== 'source')
  for (const n of items) if (n.kind === 'quiz' && n.sessionId) links.push({ source: n.id, target: n.sessionId, kind: 'made-from', weight: 1 })
  if (showSources) {
    for (const s of sources.values()) nodes.push({ id: sourceNodeId(s.id), kind: 'source', label: s.title, source: s })
    for (const n of items) for (const m of n.sources) links.push({ source: n.id, target: sourceNodeId(m), kind: 'uses', weight: 1 })
  } else {
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const shared = items[i].sources.filter(m => items[j].sources.includes(m)).length
      if (shared) links.push({ source: items[i].id, target: items[j].id, kind: 'shares', weight: shared })
    }
  }
  return { nodes, links, sources }
}

// ---- Motivation ----

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/** Consecutive days with any study activity, ending today (or yesterday, if nothing yet today). */
export function streak(activity: string[], now = new Date()) {
  const days = new Set(activity.map(a => dayKey(new Date(a))))
  const d = new Date(now)
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1)
  let n = 0
  while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1) }
  return { days: n, today: days.has(dayKey(now)) }
}

export function brainStats({ chats, current, sets }: BrainInput, now = new Date()) {
  const statuses = sets.map(quizStatus)
  const taken = statuses.filter(s => s !== 'untaken').length
  const passedCount = statuses.filter(s => s === 'passed' || s === 'retook').length
  const activity = [
    ...chats.map(c => c.updatedAt),
    ...(current.turns.length ? [now.toISOString()] : []),
    ...sets.flatMap(s => [s.createdAt, ...attemptsOf(s).map(a => a.at)]),
  ]
  const sessionCount = chats.filter(c => c.id !== current.id).length + (current.turns.length ? 1 : 0)
  const questions = chats.filter(c => c.id !== current.id).reduce((a, c) => a + c.turns.length, 0) + current.turns.length
  // What to do next: fix red quizzes first, then take untaken ones.
  const failed = sets.filter(s => quizStatus(s) === 'failed')
  const untaken = sets.filter(s => quizStatus(s) === 'untaken')
  const next = failed[0] ? { kind: 'retake' as const, set: failed[0] } : untaken[0] ? { kind: 'take' as const, set: untaken[0] } : null
  return {
    sessions: sessionCount, questions, quizzes: sets.length, taken, passed: passedCount,
    passRate: taken ? Math.round((passedCount / taken) * 100) : null,
    counts: { passed: statuses.filter(s => s === 'passed').length, retook: statuses.filter(s => s === 'retook').length, failed: failed.length, untaken: untaken.length },
    streak: streak(activity, now), next,
  }
}
