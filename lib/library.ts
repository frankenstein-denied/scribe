import type { Format } from '@/lib/extract'
import { listReadyMaterials, loadChunks } from '@/lib/materials'
import { subjects } from '@/types'

// Everything students can get answers from: every instructor's ready materials in Firestore, flattened into passages.

export type Passage = {
  id: string
  materialId: string
  title: string
  fileName: string
  format: Format
  subjectId: string
  subjectCode: string
  profName: string
  page?: number
  text: string
}

/** A ready file, as students see it: for listing, filtering by instructor/subject/type/date, and summaries. */
export type MaterialInfo = {
  id: string
  title: string
  fileName: string
  format: Format
  subjectId: string
  subjectCode: string
  ownerName: string
  ownerEmail: string
  pages?: number
  createdAt: string
  terms: Record<string, number>
  excerpt: string
}

export type Library = { passages: Passage[]; materials: MaterialInfo[]; materialCount: number; subjectIds: string[] }

export async function loadLibrary(): Promise<Library> {
  const ready = await listReadyMaterials()
  const withChunks = await Promise.all(ready.map(async m => ({ m, chunks: await loadChunks(m.id) })))
  const passages: Passage[] = []
  const materials: MaterialInfo[] = []
  const subjectIds = new Set<string>()
  let materialCount = 0
  for (const { m, chunks } of withChunks) {
    if (!chunks.length) continue
    materialCount++
    if (m.subjectId) subjectIds.add(m.subjectId)
    const subjectCode = subjects.find(s => s.id === m.subjectId)?.code ?? ''
    materials.push({ id: m.id, title: m.title, fileName: m.fileName, format: m.format, subjectId: m.subjectId, subjectCode, ownerName: m.ownerName, ownerEmail: m.ownerEmail, pages: m.pages, createdAt: m.createdAt, terms: m.terms, excerpt: m.excerpt })
    chunks.forEach((c, i) => passages.push({
      id: `${m.id}:${i}`, materialId: m.id, title: m.title, fileName: m.fileName, format: m.format,
      subjectId: m.subjectId, subjectCode, profName: m.ownerName, page: c.page, text: c.text,
    }))
  }
  return { passages, materials, materialCount, subjectIds: [...subjectIds] }
}
