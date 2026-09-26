import { collection, deleteDoc, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { ImportPlan, VerifiedInstructor } from '@/lib/verified'

// Firestore: /verifiedInstructors/{email}. Only admins can read the whole list or write it (see firestore.rules).
const col = () => collection(db, 'verifiedInstructors')

export async function listVerified(): Promise<VerifiedInstructor[]> {
  const snap = await getDocs(col())
  return snap.docs.map(d => d.data() as VerifiedInstructor).sort((a, b) => b.addedAt.localeCompare(a.addedAt))
}

export const addVerified = (v: VerifiedInstructor) => setDoc(doc(col(), v.email), v)
export const removeVerified = (email: string) => deleteDoc(doc(col(), email))

/** Writes a CSV import: new instructors and name updates, in batches under Firestore's 500-write limit. */
export async function commitImport(plan: ImportPlan, existing: VerifiedInstructor[]) {
  const now = new Date().toISOString()
  const writes: VerifiedInstructor[] = [
    ...plan.add.map(a => ({ name: a.name, email: a.email, addedAt: now, source: 'csv' as const })),
    ...plan.rename.map(r => ({ ...existing.find(v => v.email === r.email)!, name: r.name })),
  ]
  for (let i = 0; i < writes.length; i += 450) {
    const batch = writeBatch(db)
    for (const v of writes.slice(i, i + 450)) batch.set(doc(col(), v.email), v)
    await batch.commit()
  }
}

/** Puts back entries removed by mistake (Undo). */
export async function restoreVerified(entries: VerifiedInstructor[]) {
  const batch = writeBatch(db)
  for (const v of entries) batch.set(doc(col(), v.email), v)
  await batch.commit()
}
