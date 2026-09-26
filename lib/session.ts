'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { FirebaseError } from 'firebase/app'
import { auth, db, isSchoolEmail, schoolGoogleProvider, SCHOOL_DOMAIN } from '@/lib/firebase'
import type { Role, User } from '@/types'

/** A signed-in SorSU account. `role` has been checked against Firestore, not just claimed. */
export type AppUser = User & { uid: string; email: string }

export const homeFor = (role: Role) => (role === 'Professor' ? '/instructor' : role === 'Admin' ? '/admin' : '/')

const PROGRAM: Record<Role, string> = { Student: 'SorSU', Professor: 'SorSU Faculty', Admin: 'Administrator' }
const firstNameOf = (name: string) => (name.includes(',') ? name.split(',')[1] : name).trim().split(' ')[0]

/** The role's Firestore grant: the admin list for admins, the verified list for instructors. */
async function grantFor(role: Role, email: string): Promise<{ ok: boolean; name?: string }> {
  if (role === 'Student') return { ok: true }
  const snap = await getDoc(doc(db, role === 'Admin' ? 'admins' : 'verifiedInstructors', email))
  return { ok: snap.exists(), name: snap.data()?.name }
}

export type AuthResult = { ok: true; user: AppUser } | { ok: false; error: string }

const friendlyError = (e: unknown) => {
  const code = e instanceof FirebaseError ? e.code : ''
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in was cancelled.'
  if (code === 'auth/popup-blocked') return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.'
  if (code === 'auth/network-request-failed' || code === 'unavailable') return 'Can’t reach the server. Check your internet connection and try again.'
  if (code === 'auth/unauthorized-domain') return 'This web address isn’t allowed to sign in yet. Add it under Firebase console › Authentication › Settings › Authorized domains.'
  return 'Sign-in failed. Please try again.'
}

/** Google sign-in restricted to @sorsu.edu.ph, then a Firestore check that the account may use `role`. */
export async function signInWithGoogle(role: Role): Promise<AuthResult> {
  try {
    const { user: fb } = await signInWithPopup(auth, schoolGoogleProvider())
    const email = fb.email?.toLowerCase() ?? ''
    if (!isSchoolEmail(email) || !fb.emailVerified) {
      await firebaseSignOut(auth)
      return { ok: false, error: `${email || 'That account'} isn’t a SorSU account. Sign in with your @${SCHOOL_DOMAIN} Google account.` }
    }
    const grant = await grantFor(role, email)
    if (!grant.ok) {
      await firebaseSignOut(auth)
      return { ok: false, error: role === 'Professor'
        ? `${email} isn’t a verified instructor. Ask your CICT admin to add your email, or sign in as a student.`
        : `${email} isn’t an admin account.` }
    }
    const name = grant.name ?? fb.displayName ?? email.split('@')[0]
    const user: AppUser = { uid: fb.uid, email, name, firstName: firstNameOf(name), role, program: PROGRAM[role] }
    await setDoc(doc(db, 'users', fb.uid), { name, email, role, program: user.program, updatedAt: serverTimestamp() }, { merge: true })
    return { ok: true, user }
  } catch (e) {
    return { ok: false, error: friendlyError(e) }
  }
}

export const signOut = () => firebaseSignOut(auth)

/**
 * The signed-in user for a page. Sends signed-out visitors to /login, re-checks the role's Firestore grant on
 * every load (so an admin removing an instructor takes effect), and sends users whose role can't use this page home.
 */
export function useSession(allow?: Role[]): AppUser | null {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const allowKey = allow?.join(',')

  useEffect(() => onAuthStateChanged(auth, async fb => {
    if (!fb?.email || !isSchoolEmail(fb.email)) { setUser(null); router.replace('/login'); return }
    try {
      const profile = await getDoc(doc(db, 'users', fb.uid))
      if (!profile.exists()) { await firebaseSignOut(auth); router.replace('/login'); return }
      const data = profile.data() as { name: string; role: Role; program?: string }
      const email = fb.email.toLowerCase()
      if (!(await grantFor(data.role, email)).ok) {
        await firebaseSignOut(auth)
        router.replace(`/login?denied=${data.role === 'Admin' ? 'admin' : 'instructor'}`)
        return
      }
      const u: AppUser = { uid: fb.uid, email, name: data.name, firstName: firstNameOf(data.name), role: data.role, program: data.program ?? PROGRAM[data.role] }
      if (allowKey && !allowKey.split(',').includes(u.role)) { router.replace(homeFor(u.role)); return }
      setUser(u)
    } catch {
      router.replace('/login?denied=offline')
    }
  }), [router, allowKey])

  return user
}
