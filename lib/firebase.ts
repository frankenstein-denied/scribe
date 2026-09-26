import { getApp, getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore'

export const SCHOOL_DOMAIN = 'sorsu.edu.ph'
export const isSchoolEmail = (email: string | null | undefined) => !!email && email.trim().toLowerCase().endsWith(`@${SCHOOL_DOMAIN}`)

const app = getApps().length ? getApp() : initializeApp({
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
})

export const auth = getAuth(app)

// Optional fields are often undefined in our objects; Firestore would otherwise reject the whole write.
let firestore: Firestore
try {
  firestore = initializeFirestore(app, { ignoreUndefinedProperties: true })
} catch {
  firestore = getFirestore(app) // already initialized (hot reload)
}
export const db = firestore

if (process.env.NEXT_PUBLIC_USE_EMULATORS === 'true' && typeof window !== 'undefined' && !(globalThis as { __scribeEmu?: boolean }).__scribeEmu) {
  (globalThis as { __scribeEmu?: boolean }).__scribeEmu = true
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}

/** Google sign-in that only offers @sorsu.edu.ph accounts in the account picker. The app and rules still check. */
export function schoolGoogleProvider() {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ hd: SCHOOL_DOMAIN, prompt: 'select_account' })
  return provider
}
