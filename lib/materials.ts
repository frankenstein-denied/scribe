import { del, get, set } from 'idb-keyval'
import { collection, doc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Chunk } from '@/lib/chunks'
import type { Format } from '@/lib/extract'
import type { TermCounts } from '@/lib/topics'

// Firestore: /materials/{id} holds the file's details; /materials/{id}/content/{n} holds its passages, split so each
// doc stays well under Firestore's 1 MB limit. The original file is only cached in the uploader's browser (IndexedDB),
// since storing files needs Firebase Storage (Blaze plan).
export type InstructorMaterial = {
  id: string
  ownerUid: string
  ownerEmail: string
  ownerName: string
  title: string
  fileName: string
  format: Format
  size: number
  subjectId: string
  pages?: number
  status: 'processing' | 'ready' | 'failed'
  error?: string
  terms: TermCounts
  excerpt: string
  createdAt: string
}

const materials = () => collection(db, 'materials')
const contentOf = (id: string) => collection(db, 'materials', id, 'content')

export async function listMyMaterials(uid: string): Promise<InstructorMaterial[]> {
  const snap = await getDocs(query(materials(), where('ownerUid', '==', uid)))
  return snap.docs.map(d => d.data() as InstructorMaterial).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function listReadyMaterials(): Promise<InstructorMaterial[]> {
  const snap = await getDocs(query(materials(), where('status', '==', 'ready')))
  return snap.docs.map(d => d.data() as InstructorMaterial)
}

export const createMaterial = (m: InstructorMaterial) => setDoc(doc(materials(), m.id), m)
export const updateMaterial = (id: string, change: Partial<InstructorMaterial>) => updateDoc(doc(materials(), id), change)

// Characters of JSON per content doc. Non-English text can take up to 3 bytes a character, so this leaves headroom under 1 MB.
const PART_BUDGET = 300_000

export async function saveChunks(id: string, chunks: Chunk[]) {
  const parts: Chunk[][] = [[]]
  let size = 0
  for (const c of chunks) {
    const s = JSON.stringify(c).length
    if (size + s > PART_BUDGET && parts[parts.length - 1].length) { parts.push([]); size = 0 }
    parts[parts.length - 1].push(c)
    size += s
  }
  const batch = writeBatch(db)
  parts.forEach((p, i) => batch.set(doc(contentOf(id), String(i).padStart(3, '0')), { chunks: p }))
  await batch.commit()
}

export async function loadChunks(id: string): Promise<Chunk[]> {
  const snap = await getDocs(contentOf(id))
  return snap.docs.sort((a, b) => a.id.localeCompare(b.id)).flatMap(d => (d.data().chunks as Chunk[]) ?? [])
}

/** Removes the file's passages and details together. */
export async function deleteMaterial(id: string) {
  const parts = await getDocs(contentOf(id))
  const batch = writeBatch(db)
  parts.docs.forEach(d => batch.delete(d.ref))
  batch.delete(doc(materials(), id))
  await batch.commit()
}

// ---- Original files, cached only in this browser ----
const blobKey = (id: string) => `material-file:${id}`
export const saveFile = (id: string, file: Blob) => set(blobKey(id), file)
export const loadFile = (id: string) => get<Blob>(blobKey(id))
export const deleteFile = (id: string) => del(blobKey(id))

export const titleFromFileName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()

export function formatBytes(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}
