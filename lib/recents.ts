import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Passage } from '@/lib/library'

// Firestore: /users/{uid}/chats/{id} holds finished conversations (Recents). The open conversation stays in this
// tab's sessionStorage until it's filed by "New chat", switching chats, or logging out.

/**
 * One notebook cell. Every cell carries the passage it came from (for citations, quizzes and the 2nd brain).
 * `kind` changes how it's drawn: a passage, a file card (browse), a key term (reviewer glossary) or a list.
 */
export type ChatCell = {
  id: string
  passage: Passage
  excerpt: string
  kind?: 'passage' | 'material' | 'term' | 'list'
  heading?: string
  meta?: { topics?: string[]; pages?: number; uploadedAt?: string }
}
export type ChatPart = { label: string; query: string; cells: ChatCell[] }
/** `note` is a one-line explanation above the answer ("Reviewer on machine learning · from 3 files"). */
export type ChatTurn = { id: string; question: string; scope: string | null; parts: ChatPart[]; intent?: string; note?: string }
export type RecentChat = { id: string; title: string; updatedAt: string; turns: ChatTurn[] }

export const MAX_RECENTS = 30

const chats = (uid: string) => collection(db, 'users', uid, 'chats')

export async function listChats(uid: string): Promise<RecentChat[]> {
  const snap = await getDocs(chats(uid))
  return snap.docs.map(d => d.data() as RecentChat).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

// Firestore documents max out at 1 MB. A very long chat drops the full passages (keeping each cell's excerpt).
const DOC_BUDGET = 700_000
function fitToDoc(chat: RecentChat): RecentChat {
  if (JSON.stringify(chat).length <= DOC_BUDGET) return chat
  const slim = { ...chat, turns: chat.turns.map(t => ({ ...t, parts: t.parts.map(p => ({ ...p, cells: p.cells.map(c => ({ ...c, passage: { ...c.passage, text: c.excerpt } })) })) })) }
  // Still too big: keep the most recent turns.
  while (slim.turns.length > 1 && JSON.stringify(slim).length > DOC_BUDGET) slim.turns = slim.turns.slice(1)
  return slim
}

export const putChat = (uid: string, chat: RecentChat) => setDoc(doc(chats(uid), chat.id), fitToDoc(chat))
export const deleteChat = (uid: string, id: string) => deleteDoc(doc(chats(uid), id))

export const titleFor = (turns: ChatTurn[]) => {
  const q = turns[0]?.question.replace(/\s+/g, ' ').trim() ?? 'Untitled chat'
  return q.length > 48 ? q.slice(0, 47).trimEnd() + '…' : q
}

/**
 * Files a conversation into Recents: returns the new list, the chat to save, and any chats pushed past the limit.
 * An unchanged, already-saved chat keeps its place and needs no write.
 */
export function archive(list: RecentChat[], id: string | null, turns: ChatTurn[]): { list: RecentChat[]; save?: RecentChat; drop: string[] } {
  if (!turns.length) return { list, drop: [] }
  const existing = id ? list.find(c => c.id === id) : undefined
  if (existing && existing.turns.length === turns.length) return { list, drop: [] }
  const save: RecentChat = { id: id ?? crypto.randomUUID(), title: titleFor(turns), updatedAt: new Date().toISOString(), turns }
  const all = [save, ...list.filter(c => c.id !== save.id)]
  return { list: all.slice(0, MAX_RECENTS), save, drop: all.slice(MAX_RECENTS).map(c => c.id) }
}

/** Writes the result of `archive` to Firestore. */
export async function persistArchive(uid: string, result: ReturnType<typeof archive>) {
  await Promise.all([...(result.save ? [putChat(uid, result.save)] : []), ...result.drop.map(id => deleteChat(uid, id))])
}

// ---- The open conversation (this tab only) ----
export const chatKey = (uid: string) => `scribe-chat:${uid}`

export function readCurrent(uid: string): { id: string | null; turns: ChatTurn[] } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(chatKey(uid)) ?? 'null')
    if (saved?.turns) return saved
  } catch {}
  return { id: null, turns: [] }
}

/** Files the tab's open conversation into Recents and clears it (used on logout, from any page). */
export async function archiveOpenChat(uid: string) {
  const current = readCurrent(uid)
  try {
    if (current.turns.length) await persistArchive(uid, archive(await listChats(uid), current.id, current.turns))
  } finally {
    try { sessionStorage.removeItem(chatKey(uid)) } catch {}
  }
}
