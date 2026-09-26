import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { QuizKind } from '@/lib/quiz'
import type { Review } from '@/lib/review'
import type { StudyItem } from '@/types'

// Firestore: /users/{uid}/studySets/{id}. Only the owner can read or write them (see firestore.rules).
export const MAX_STUDY_SETS = 20

export type SavedStudySet = {
  id: string
  title: string
  kind: QuizKind
  createdAt: string
  /** Kept in the order of the current take; retakes reorder them by spaced repetition. */
  items: StudyItem[]
  subjectCodes: string[]
  sourceCount: number
  review: Review
  attempts: number
  lastScore?: Attempt
  /** Every finished take, oldest first. Sets made before this existed only have `lastScore`. */
  history?: Attempt[]
  /** The chat (Recents id) the quiz was made from, linking them in the 2nd brain. */
  sourceChatId?: string
}

export type Attempt = { correct: number; total: number; at: string }

const sets = (uid: string) => collection(db, 'users', uid, 'studySets')

export async function listSets(uid: string): Promise<SavedStudySet[]> {
  const snap = await getDocs(sets(uid))
  return snap.docs.map(d => d.data() as SavedStudySet)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export const putSet = (uid: string, s: SavedStudySet) => setDoc(doc(sets(uid), s.id), s)
export const deleteSet = (uid: string, id: string) => deleteDoc(doc(sets(uid), id))

/** Questions missed on the last take. */
export const toReview = (s: SavedStudySet) => Object.values(s.review).filter(r => !r.lastCorrect).length
