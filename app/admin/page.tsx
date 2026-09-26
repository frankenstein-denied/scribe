'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, LogOut, Search, ShieldCheck, Sparkles, Trash2, Undo2, UserPlus, X } from 'lucide-react'
import { signOut, useSession } from '@/lib/session'
import { ThemeToggle } from '@/components/theme-toggle'
import { applyImport, CSV_TEMPLATE, cleanName, manualEntryError, normalizeEmail, planImport, SCHOOL_SUFFIX, type ImportPlan, type VerifiedInstructor } from '@/lib/verified'
import { addVerified, commitImport, listVerified, removeVerified, restoreVerified } from '@/lib/verified-store'
import '../instructor/dashboard.css'
import './admin.css'

const SOURCE_LABEL: Record<VerifiedInstructor['source'], string> = { manual: 'Added manually', csv: 'CSV import' }
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function AdminDashboard() {
  const router = useRouter()
  const user = useSession(['Admin'])
  const [list, setList] = useState<VerifiedInstructor[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState<{ text: string; undo?: VerifiedInstructor[]; error?: boolean } | null>(null)
  const [plan, setPlan] = useState<(ImportPlan & { fileName: string }) | null>(null)
  const [csvError, setCsvError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [query, setQuery] = useState('')
  const csvInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return
    listVerified().then(setList).catch(() => setLoadError('Couldn’t load the verified list. Check your connection and reload the page.')).finally(() => setLoading(false))
  }, [user])

  const serverError = () => setNotice({ text: 'That change couldn’t be saved. Check your connection and try again.', error: true })

  const addManual = async (e: React.FormEvent) => {
    e.preventDefault()
    const error = manualEntryError(name, email, list)
    if (error) return setFormError(error)
    const entry: VerifiedInstructor = { name: cleanName(name), email: normalizeEmail(email), addedAt: new Date().toISOString(), source: 'manual' }
    setBusy(true)
    try {
      await addVerified(entry)
      setList(l => [entry, ...l])
      setNotice({ text: `${entry.name} can now sign in as an instructor.` })
      setName(''); setEmail(''); setFormError('')
    } catch { serverError() } finally { setBusy(false) }
  }

  const readCsv = async (file: File | undefined) => {
    setCsvError(''); setPlan(null)
    if (!file) return
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') return setCsvError('Choose a .csv file. In Excel or Google Sheets, use File › Download › CSV.')
    if (file.size > 2 * 1024 * 1024) return setCsvError('That file is larger than 2 MB. Split it into smaller files.')
    const result = planImport(await file.text(), list)
    if (!result.add.length && !result.rename.length && !result.skipped.length) return setCsvError(result.unchanged ? 'Everyone in this file is already verified.' : 'No rows found. The file should have a name and an email on each line.')
    setPlan({ ...result, fileName: file.name })
  }

  const confirmImport = async () => {
    if (!plan) return
    setBusy(true)
    try {
      await commitImport(plan, list)
      setList(applyImport(plan, list))
      const parts = [plan.add.length && `${plan.add.length} added`, plan.rename.length && `${plan.rename.length} renamed`].filter(Boolean)
      setNotice({ text: `Imported ${plan.fileName}: ${parts.join(', ') || 'nothing to change'}.` })
      setPlan(null)
    } catch { serverError() } finally { setBusy(false) }
  }

  const remove = async (v: VerifiedInstructor) => {
    try {
      await removeVerified(v.email)
      setList(l => l.filter(x => x.email !== v.email))
      setNotice({ text: `${v.name} (${v.email}) can no longer sign in as an instructor.`, undo: [v] })
    } catch { serverError() }
  }

  const undo = async (entries: VerifiedInstructor[]) => {
    try {
      await restoreVerified(entries)
      setList(l => [...entries, ...l.filter(x => !entries.some(e => e.email === x.email))].sort((a, b) => b.addedAt.localeCompare(a.addedAt)))
      setNotice(null)
    } catch { serverError() }
  }

  const downloadTemplate = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }))
    a.download = 'verified-instructors-template.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? list.filter(v => v.name.toLowerCase().includes(q) || v.email.includes(q)) : list
  }, [list, query])

  if (!user) return null
  const initials = user.name.split(' ').map(w => w[0]).slice(0, 2).join('')
  const importable = plan ? plan.add.length + plan.rename.length : 0

  return <div className="app-shell instructor">
    <aside className="sidebar">
      <div className="brand-row"><span className="brand">SCRIBE</span></div>
      <nav className="nav-list" aria-label="Admin navigation">
        <p className="nav-label">Admin</p>
        <span className="nav-item active"><ShieldCheck /> Verified instructors</span>
        <Link className="nav-item" href="/"><Sparkles /> Ask SCRIBE</Link>
      </nav>
      <div className="sidebar-bottom">
        <div className="profile"><div className="avatar">{initials}</div><div><strong>{user.name}</strong><span>{user.email}</span></div></div>
        <button className="logout-button" onClick={() => signOut().then(() => router.replace('/login'))}><LogOut /> Log out</button>
        <ThemeToggle />
      </div>
    </aside>

    <main className="dash-main">
      <header className="dash-header">
        <div className="mobile-only header-actions"><ThemeToggle compact /><button className="logout-button" onClick={() => signOut().then(() => router.replace('/login'))}><LogOut /> Log out</button></div>
        <div><h1>Verified instructors</h1><p>Only these Google accounts can sign in as Professor / Instructor. Anyone else is turned away at login.</p></div>
      </header>

      {notice && <div className={`admin-notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>
        {notice.error ? <AlertCircle /> : <CheckCircle2 />}<span>{notice.text}</span>
        {notice.undo && <button className="text-link" onClick={() => undo(notice.undo!)}><Undo2 /> Undo</button>}
        <button className="icon-button" aria-label="Dismiss" onClick={() => setNotice(null)}><X /></button>
      </div>}

      <div className="admin-grid">
        <form className="admin-card" onSubmit={addManual} noValidate>
          <h2><UserPlus /> Add an instructor</h2>
          <label>Full name<input value={name} onChange={e => { setName(e.target.value); setFormError('') }} placeholder="Juan Dela Cruz" autoComplete="off" /></label>
          <label>Email<input type="email" value={email} onChange={e => { setEmail(e.target.value); setFormError('') }} placeholder={`juan.delacruz${SCHOOL_SUFFIX}`} autoComplete="off" aria-invalid={!!formError} /></label>
          {formError && <p className="field-error" role="alert"><AlertCircle /> {formError}</p>}
          <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Add instructor'}</button>
        </form>

        <section
          className={`admin-card csv-card ${dragging ? 'dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); readCsv(e.dataTransfer.files[0]) }}
        >
          <h2><FileSpreadsheet /> Import from CSV</h2>
          <p>One instructor per line: <code>name,email</code>. A header row is optional.</p>
          <div className="csv-drop">
            <span>Drop a .csv file here or</span>
            <button className="outline-button" onClick={() => csvInput.current?.click()}>Choose file</button>
          </div>
          <button className="text-link small" onClick={downloadTemplate}><Download /> Download template</button>
          {csvError && <p className="field-error" role="alert"><AlertCircle /> {csvError}</p>}
          <input ref={csvInput} type="file" accept=".csv,text/csv" hidden onChange={e => { readCsv(e.target.files?.[0]); e.target.value = '' }} />
        </section>
      </div>

      {plan && <section className="import-preview" aria-label="Import preview">
        <div className="preview-head">
          <div><h2>Review {plan.fileName}</h2>
            <p>{plan.add.length} to add · {plan.rename.length} name update{plan.rename.length === 1 ? '' : 's'} · {plan.skipped.length} skipped{plan.unchanged ? ` · ${plan.unchanged} already verified` : ''}</p></div>
          <div className="preview-actions">
            <button className="outline-button" onClick={() => setPlan(null)}>Cancel</button>
            <button className="primary-button" disabled={!importable || busy} onClick={confirmImport}>Import {importable} {importable === 1 ? 'instructor' : 'instructors'}</button>
          </div>
        </div>
        {plan.add.length > 0 && <><h3>Will be added</h3><ul className="preview-list">{plan.add.map(a => <li key={a.email}><strong>{a.name}</strong><span>{a.email}</span></li>)}</ul></>}
        {plan.rename.length > 0 && <><h3>Name will be updated</h3><ul className="preview-list">{plan.rename.map(r => <li key={r.email}><strong>{r.previousName} → {r.name}</strong><span>{r.email}</span></li>)}</ul></>}
        {plan.skipped.length > 0 && <><h3>Skipped</h3><ul className="preview-list skipped">{plan.skipped.map(s => <li key={s.line}><strong>Line {s.line}: {s.reason}</strong><span>{s.text || '(empty)'}</span></li>)}</ul></>}
      </section>}

      <section className="verified-section">
        <div className="verified-head">
          <h2>{list.length} verified {list.length === 1 ? 'instructor' : 'instructors'}</h2>
          <label className="graph-search"><Search /><input placeholder="Search name or email" value={query} onChange={e => setQuery(e.target.value)} /></label>
        </div>
        {loading ? <p className="muted-line">Loading…</p> : loadError ? <p className="field-error" role="alert"><AlertCircle /> {loadError}</p> : list.length === 0
          ? <div className="empty-materials"><ShieldCheck /><strong>No verified instructors</strong><span>Nobody can sign in as an instructor until you add them.</span></div>
          : shown.length === 0
            ? <p className="muted-line">No instructor matches “{query}”.</p>
            : <ul className="material-list">{shown.map(v => <li key={v.email} className="verified-row">
              <div className="avatar">{v.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}</div>
              <div className="material-main"><strong>{v.name}</strong><span>{v.email}</span></div>
              <span className="verified-meta">{SOURCE_LABEL[v.source]} · {formatDate(v.addedAt)}</span>
              <button className="icon-button danger" aria-label={`Remove ${v.name}`} title="Remove access" onClick={() => remove(v)}><Trash2 /></button>
            </li>)}</ul>}
      </section>
    </main>
  </div>
}
