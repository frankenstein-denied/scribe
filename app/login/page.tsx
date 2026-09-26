'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { AlertCircle, GraduationCap, Loader2, Presentation, ShieldCheck } from 'lucide-react'
import { auth, db, isSchoolEmail, SCHOOL_DOMAIN } from '@/lib/firebase'
import { ScribeAvatar, SCRIBE_GREETING } from '@/components/scribe/avatar'
import { homeFor, signInWithGoogle } from '@/lib/session'
import type { Role } from '@/types'

const roles: { role: Role; label: string; hint: string; Icon: typeof GraduationCap }[] = [
  { role: 'Student', label: 'Student', hint: 'Ask questions and review study sets', Icon: GraduationCap },
  { role: 'Professor', label: 'Professor / Instructor', hint: 'Upload materials (verified accounts only)', Icon: Presentation },
  { role: 'Admin', label: 'Admin', hint: 'Verify instructors and manage access', Icon: ShieldCheck },
]

const DENIED: Record<string, string> = {
  instructor: 'Your instructor access was removed by an admin. Ask your CICT admin to verify your email again, or sign in as a student.',
  admin: 'This account no longer has admin access.',
  offline: 'Couldn’t reach the server to check your account. Check your connection and sign in again.',
}

function GoogleMark() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
}

export default function LoginPage() {
  const router = useRouter()
  const [role, setRole] = useState<Role>('Student')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const signingIn = useRef(false)

  useEffect(() => {
    const denied = new URLSearchParams(window.location.search).get('denied')
    if (denied) { setError(DENIED[denied] ?? DENIED.offline); return }
    // Already signed in: go straight to the right dashboard. Only on arrival: during a sign-in the
    // role checks in `login` decide where to go (or whether to reject).
    return onAuthStateChanged(auth, async fb => {
      if (signingIn.current || !fb?.email || !isSchoolEmail(fb.email)) return
      try {
        const profile = await getDoc(doc(db, 'users', fb.uid))
        if (profile.exists()) router.replace(homeFor(profile.data().role as Role))
      } catch {}
    })
  }, [router])

  const login = async () => {
    signingIn.current = true
    setBusy(true); setError('')
    const result = await signInWithGoogle(role)
    if (result.ok) return router.replace(homeFor(result.user.role))
    signingIn.current = false
    setError(result.error); setBusy(false)
  }

  return <main className="login-shell">
    <div className="login-layout">
    <div className="login-hero">
      <p className="speech down">{SCRIBE_GREETING}<small>Sign in with your SorSU Google account to get started.</small></p>
      <ScribeAvatar size={320} />
    </div>
    <section className="login-card" aria-labelledby="login-title">
      <span className="brand">SCRIBE</span>
      <h1 id="login-title">Sign in to SCRIBE</h1>
      <p className="login-sub">Answers grounded in your CICT professors&apos; uploaded materials.</p>

      <fieldset className="role-picker" disabled={busy}>
        <legend>I am signing in as</legend>
        {roles.map(({ role: r, label, hint, Icon }) => <label key={r} className={`role-option ${role === r ? 'selected' : ''}`}>
          <input type="radio" name="role" value={r} checked={role === r} onChange={() => { setRole(r); setError('') }} />
          <Icon /><span><strong>{label}</strong><small>{hint}</small></span>
        </label>)}
      </fieldset>

      {error && <p id="login-error" className="login-error" role="alert"><AlertCircle /> {error}</p>}
      <button className="google-button" onClick={login} disabled={busy} aria-describedby={error ? 'login-error' : undefined}>
        {busy ? <Loader2 className="spin" /> : <GoogleMark />} {busy ? 'Signing in…' : 'Continue with Google'}
      </button>

      <p className="login-note">Only <strong>@{SCHOOL_DOMAIN}</strong> Google accounts can sign in. Instructors must be verified by a CICT admin first.</p>
    </section>
    </div>
  </main>
}
