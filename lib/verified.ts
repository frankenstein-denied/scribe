// Verified instructor emails, managed by admins. Only these accounts may sign in as Professor / Instructor.
// Pure functions (validation and CSV import planning). Firestore reads/writes live in verified-store.ts.

export type VerifiedInstructor = { name: string; email: string; addedAt: string; source: 'manual' | 'csv' }

export const SCHOOL_SUFFIX = '@sorsu.edu.ph'

export const normalizeEmail = (email: string) => email.trim().toLowerCase()
export const isValidEmail = (email: string) => /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i.test(email.trim())
export const isSchoolAddress = (email: string) => normalizeEmail(email).endsWith(SCHOOL_SUFFIX)
export const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ')

export function findVerified(email: string, list: VerifiedInstructor[]) {
  const e = normalizeEmail(email)
  return list.find(v => v.email === e)
}

/** Why a manual entry can't be added, or null if it can. */
export function manualEntryError(name: string, email: string, list: VerifiedInstructor[]): string | null {
  if (!cleanName(name)) return 'Enter the instructor’s name.'
  if (cleanName(name).length > 120) return 'That name is too long.'
  if (!isValidEmail(email)) return 'Enter a valid email address.'
  if (!isSchoolAddress(email)) return `Only ${SCHOOL_SUFFIX} emails can be verified.`
  if (findVerified(email, list)) return 'This email is already verified.'
  return null
}

/** Minimal RFC 4180 CSV: commas, double-quoted fields, "" escapes, CRLF or LF line endings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

export type ImportPlan = {
  add: { name: string; email: string; line: number }[]
  rename: { name: string; email: string; previousName: string; line: number }[]
  skipped: { line: number; text: string; reason: string }[]
  unchanged: number
}

/**
 * Works out what importing a "name,email" CSV would do, without changing anything.
 * Accepts an optional header row and columns in either order (the email column is detected).
 */
export function planImport(csv: string, existing: VerifiedInstructor[]): ImportPlan {
  const plan: ImportPlan = { add: [], rename: [], skipped: [], unchanged: 0 }
  const seen = new Set<string>()
  parseCsv(csv).forEach((cells, i) => {
    const line = i + 1
    const text = cells.join(',')
    if (cells.every(c => !c.trim())) return
    if (i === 0 && cells.some(c => /^\s*e-?mail\s*$/i.test(c))) return
    const emailAt = cells.findIndex(c => c.includes('@'))
    if (emailAt === -1) return void plan.skipped.push({ line, text, reason: 'No email address' })
    const email = normalizeEmail(cells[emailAt])
    const name = cleanName(cells.filter((_, j) => j !== emailAt).join(' '))
    if (!isValidEmail(email)) return void plan.skipped.push({ line, text, reason: 'Invalid email address' })
    if (!isSchoolAddress(email)) return void plan.skipped.push({ line, text, reason: `Not a ${SCHOOL_SUFFIX} email` })
    if (!name) return void plan.skipped.push({ line, text, reason: 'Missing name' })
    if (name.length > 120) return void plan.skipped.push({ line, text, reason: 'Name too long' })
    if (seen.has(email)) return void plan.skipped.push({ line, text, reason: 'Duplicate email in this file' })
    seen.add(email)
    const current = existing.find(v => v.email === email)
    if (!current) plan.add.push({ name, email, line })
    else if (current.name !== name) plan.rename.push({ name, email, previousName: current.name, line })
    else plan.unchanged++
  })
  return plan
}

export function applyImport(plan: ImportPlan, existing: VerifiedInstructor[]): VerifiedInstructor[] {
  const now = new Date().toISOString()
  const renamed = new Map(plan.rename.map(r => [r.email, r.name]))
  return [
    ...plan.add.map(a => ({ name: a.name, email: a.email, addedAt: now, source: 'csv' as const })),
    ...existing.map(v => (renamed.has(v.email) ? { ...v, name: renamed.get(v.email)! } : v)),
  ]
}

export const CSV_TEMPLATE = 'name,email\nMaria Rodrigueza,maria.rodrigueza@sorsu.edu.ph\n"Dela Cruz, Juan",juan.delacruz@sorsu.edu.ph\n'
