import { collection, doc, getDocs, increment, query, setDoc, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Library, Passage } from '@/lib/library'

// Weekly per-file usage counters (one doc per material per week). They feed the instructor heatmap.
export type UsageKind = 'answers' | 'quizzes' | 'assistant'
export type UsageRow = { materialId: string; ownerEmail: string; week: string; answers: number; quizzes: number; assistant: number }

const pad = (n: number) => String(n).padStart(2, '0')

// Monday of the week containing d, as a local YYYY-MM-DD date.
export function weekKey(d: Date): string {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())}`
}

// The n week keys ending with the current week, oldest first.
export function lastWeeks(n: number, now = new Date()): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(weekKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7)))
  return out
}

// Maps cited passages to the files they came from, with each file's owner looked up in the library.
export function usageTargets(passages: Pick<Passage, 'materialId'>[], library: Library): { materialId: string; ownerEmail: string }[] {
  const owners = new Map(library.materials.map(m => [m.id, m.ownerEmail]))
  return passages.flatMap(p => { const o = owners.get(p.materialId); return o ? [{ materialId: p.materialId, ownerEmail: o }] : [] })
}

// Fire-and-forget: usage must never break asking or quiz creation, so every error is swallowed.
export async function recordUsage(kind: UsageKind, materials: { materialId: string; ownerEmail: string }[], viewerEmail: string | undefined): Promise<void> {
  try {
    const viewer = viewerEmail?.trim().toLowerCase()
    const week = weekKey(new Date())
    const seen = new Set<string>()
    await Promise.all(materials.map(async m => {
      if (!m.materialId || !m.ownerEmail || seen.has(m.materialId)) return
      seen.add(m.materialId)
      if (viewer && m.ownerEmail.trim().toLowerCase() === viewer) return
      try {
        await setDoc(doc(db, 'materialUsage', `${m.materialId}_${week}`), { materialId: m.materialId, ownerEmail: m.ownerEmail, week, [kind]: increment(1) }, { merge: true })
      } catch { /* ignore */ }
    }))
  } catch { /* ignore */ }
}

export async function listUsageFor(ownerEmail: string): Promise<UsageRow[]> {
  const snap = await getDocs(query(collection(db, 'materialUsage'), where('ownerEmail', '==', ownerEmail)))
  return snap.docs.map(d => {
    const x = d.data()
    return { materialId: String(x.materialId ?? ''), ownerEmail: String(x.ownerEmail ?? ownerEmail), week: String(x.week ?? ''), answers: Number(x.answers) || 0, quizzes: Number(x.quizzes) || 0, assistant: Number(x.assistant) || 0 }
  })
}
