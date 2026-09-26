'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, ExternalLink, FileText, Library, Loader2, LogOut, Maximize2, Network, Search, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { FirebaseError } from 'firebase/app'
import { signOut, useSession } from '@/lib/session'
import { ScribeWidget } from '@/components/scribe/assistant-widget'
import { ThemeToggle } from '@/components/theme-toggle'
import { ACCEPT, extractText, formatOf, rejectReason, type Format } from '@/lib/extract'
import { createMaterial, deleteFile, deleteMaterial, formatBytes, listMyMaterials, loadFile, saveChunks, saveFile, titleFromFileName, updateMaterial, type InstructorMaterial } from '@/lib/materials'
import { termCounts } from '@/lib/topics'
import { chunkPages } from '@/lib/chunks'
import { analyze, buildGraph, NODE_COLORS, toNetwork, topicNodeId } from '@/lib/graph'
import { subjects as allSubjects } from '@/types'
import './dashboard.css'

// Canvas + d3 only work in the browser.
const KnowledgeGraph = dynamic(() => import('@/components/graph/network-graph'), { ssr: false, loading: () => <div className="graph-canvas graph-loading"><Loader2 className="spin" /></div> })

type View = 'materials' | 'graph'
const FORMAT_LABEL: Record<Format, string> = { pdf: 'PDF', pptx: 'PPTX', docx: 'DOCX' }

const pageCount = (m: InstructorMaterial) => `${m.pages} ${m.format === 'pptx' ? 'slide' : 'page'}${m.pages === 1 ? '' : 's'}`

function FormatBadge({ format }: { format: Format }) {
  return <span className="format-badge" style={{ color: NODE_COLORS[format], borderColor: NODE_COLORS[format] + '55' }}>{FORMAT_LABEL[format]}</span>
}

function StatusPill({ m }: { m: InstructorMaterial }) {
  if (m.status === 'processing') return <span className="status processing"><Loader2 className="spin" /> Reading file…</span>
  if (m.status === 'failed') return <span className="status failed" title={m.error}><AlertCircle /> {m.error}</span>
  return <span className="status ready"><CheckCircle2 /> Ready</span>
}

const STALE_MS = 10 * 60 * 1000
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function InstructorDashboard() {
  const router = useRouter()
  const user = useSession(['Professor'])
  const [materials, setMaterials] = useState<InstructorMaterial[]>([])
  const [loaded, setLoaded] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [view, setView] = useState<View>('materials')
  const [uploadSubject, setUploadSubject] = useState('')
  const [rejected, setRejected] = useState<{ name: string; reason: string }[]>([])
  const [dragging, setDragging] = useState(false)
  const [showSubjects, setShowSubjects] = useState(true)
  const [showTopics, setShowTopics] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fitSignal, setFitSignal] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const queue = useRef(Promise.resolve())

  // Subjects aren't assigned to instructors yet, so every CICT subject is offered.
  const subjects = allSubjects
  const subjectOf = (id: string) => subjects.find(s => s.id === id)

  useEffect(() => {
    if (!user) return
    listMyMaterials(user.uid).then(async list => {
      // An upload whose tab closed mid-read stays 'processing' forever; mark it so the instructor can retry.
      const stale = list.filter(m => m.status === 'processing' && Date.now() - Date.parse(m.createdAt) > STALE_MS)
      const error = 'Upload was interrupted. Remove it and upload again.'
      await Promise.all(stale.map(m => updateMaterial(m.id, { status: 'failed', error }).catch(() => {})))
      const saved = list.map(m => (stale.includes(m) ? { ...m, status: 'failed' as const, error } : m))
      // Files dropped before this load finished are already in state (and newer); keep them.
      setMaterials(prev => [...prev, ...saved.filter(m => !prev.some(p => p.id === m.id))])
      setLoaded(true)
    }).catch(() => { setSyncError('Couldn’t load your materials. Check your connection and reload the page.'); setLoaded(true) })
  }, [user])

  const failSync = () => setSyncError('Some changes couldn’t be saved. Check your connection and try again.')

  /** Updates a file locally and in Firestore. */
  const patch = (id: string, change: Partial<InstructorMaterial>) => {
    setMaterials(list => list.map(m => (m.id === id ? { ...m, ...change } : m)))
    return updateMaterial(id, change).catch(failSync)
  }

  const upload = useCallback((files: FileList | File[]) => {
    const bad: { name: string; reason: string }[] = []
    for (const file of Array.from(files)) {
      const reason = rejectReason(file)
      if (reason) { bad.push({ name: file.name, reason }); continue }
      if (!user) return
      const id = crypto.randomUUID()
      const material: InstructorMaterial = {
        id, ownerUid: user.uid, ownerEmail: user.email, ownerName: user.name,
        title: titleFromFileName(file.name), fileName: file.name, format: formatOf(file.name)!, size: file.size, subjectId: uploadSubject,
        status: 'processing', terms: {}, excerpt: '', createdAt: new Date().toISOString(),
      }
      setMaterials(list => [material, ...list])
      // One file at a time keeps memory flat when someone drops a whole folder of slides.
      queue.current = queue.current.then(async () => {
        try {
          await createMaterial(material)
        } catch {
          setMaterials(list => list.map(m => (m.id === id ? { ...m, status: 'failed', error: 'Couldn’t save to the server. Check your connection and upload again.' } : m)))
          return
        }
        try {
          await saveFile(id, file)
          const { text, pages, pageTexts, paged } = await extractText(file)
          // Passages first, so a file is never 'ready' without them.
          await saveChunks(id, chunkPages(pageTexts, paged))
          await patch(id, { status: 'ready', pages, terms: termCounts(text), excerpt: text.replace(/\s+/g, ' ').slice(0, 600) })
        } catch (e) {
          await patch(id, { status: 'failed', error: e instanceof Error && !(e instanceof FirebaseError) ? e.message : 'Could not read or save this file.' })
        }
      })
    }
    setRejected(bad)
  }, [uploadSubject, user])

  const remove = async (id: string) => {
    const before = materials
    setMaterials(list => list.filter(m => m.id !== id))
    if (selectedId === id) setSelectedId(null)
    try { await deleteMaterial(id); deleteFile(id) } catch { setMaterials(before); failSync() }
  }
  const open = async (m: InstructorMaterial) => {
    const blob = await loadFile(m.id)
    if (blob) window.open(URL.createObjectURL(blob), '_blank', 'noopener')
    else setSyncError('The original file is only kept on the computer it was uploaded from. Students still get its text.')
  }

  const ready = materials.filter(m => m.status === 'ready')
  const analysis = useMemo(() => analyze(materials), [materials])
  const graph = useMemo(() => toNetwork(buildGraph(materials, subjects, analysis, { showSubjects, showTopics })), [materials, subjects, analysis, showSubjects, showTopics])

  if (!user) return null

  const selectedMaterial = materials.find(m => m.id === selectedId)
  const related = selectedMaterial ? analysis.links.filter(l => l.a === selectedMaterial.id || l.b === selectedMaterial.id).map(l => ({ ...l, other: materials.find(m => m.id === (l.a === selectedMaterial.id ? l.b : l.a))! })) : []
  const selectedTopic = selectedId?.startsWith('topic:') ? selectedId.slice(6) : null
  const selectedSubject = selectedId?.startsWith('subject:') ? subjectOf(selectedId.slice(8)) : null
  const initials = user.name.split(' ').map(w => w[0]).slice(0, 2).join('')

  return <div className="app-shell instructor">
    <aside className="sidebar">
      <div className="brand-row"><span className="brand">SCRIBE</span></div>
      <nav className="nav-list" aria-label="Instructor navigation">
        <p className="nav-label">Instructor</p>
        <button className={`nav-item ${view === 'materials' ? 'active' : ''}`} onClick={() => setView('materials')}><Library /> My materials</button>
        <button className={`nav-item ${view === 'graph' ? 'active' : ''}`} onClick={() => setView('graph')}><Network /> Knowledge graph</button>
        <Link className="nav-item" href="/"><Sparkles /> Ask SCRIBE</Link>
      </nav>
      <div className="sidebar-bottom">
        <div className="profile"><div className="avatar">{initials}</div><div><strong>{user.name}</strong><span>{user.program} · Instructor</span></div></div>
        <button className="logout-button" onClick={() => signOut().then(() => router.replace('/login'))}><LogOut /> Log out</button>
        <ThemeToggle />
      </div>
    </aside>

    <main className="dash-main">
      <header className="dash-header">
        <div className="mobile-only header-actions"><ThemeToggle compact /><button className="logout-button" onClick={() => signOut().then(() => router.replace('/login'))}><LogOut /> Log out</button></div>
        <div><h1>{view === 'materials' ? 'My materials' : 'Knowledge graph'}</h1><p>{view === 'materials' ? 'Upload lecture files. SCRIBE reads them so students get answers from your materials.' : 'How your uploaded files connect through shared topics and subjects.'}</p></div>
        <div className="mobile-tabs"><button className={view === 'materials' ? 'active' : ''} onClick={() => setView('materials')}>Materials</button><button className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}>Graph</button></div>
      </header>

      {syncError && <div className="reject-list" role="alert"><div><AlertCircle /><strong>{syncError}</strong><button className="icon-button" aria-label="Dismiss" onClick={() => setSyncError('')}><X /></button></div></div>}
      <section className="stat-row" aria-label="Summary">
        <div><strong>{materials.length}</strong><span>Files</span></div>
        <div><strong>{ready.length}</strong><span>Ready</span></div>
        <div><strong>{analysis.topics.size}</strong><span>Shared topics</span></div>
        <div><strong>{analysis.links.length}</strong><span>Connections</span></div>
      </section>

      {view === 'materials' ? <>
        <section
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files) }}
        >
          <Upload />
          <strong>Drop files here or <button className="text-link" onClick={() => fileInput.current?.click()}>browse</button></strong>
          <span>PDF, PowerPoint (.pptx), or Word (.docx) · up to 50 MB each · multiple files at once</span>
          <label className="subject-select">Add to subject
            <select value={uploadSubject} onChange={e => setUploadSubject(e.target.value)}><option value="">No subject</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.code} · {s.title}</option>)}</select>
          </label>
          <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={e => { if (e.target.files) upload(e.target.files); e.target.value = '' }} />
        </section>

        {rejected.length > 0 && <div className="reject-list" role="alert">
          <div><AlertCircle /><strong>{rejected.length} file{rejected.length > 1 ? 's' : ''} not uploaded</strong><button className="icon-button" aria-label="Dismiss" onClick={() => setRejected([])}><X /></button></div>
          <ul>{rejected.map(r => <li key={r.name}><b>{r.name}</b>: {r.reason}</li>)}</ul>
        </div>}

        {materials.length === 0
          ? <div className="empty-materials"><FileText /><strong>No materials yet</strong><span>Upload your first lecture file to start building your knowledge graph.</span></div>
          : <ul className="material-list">{materials.map(m => <li key={m.id} className="material-row">
            <FormatBadge format={m.format} />
            <div className="material-main">
              <strong>{m.title}</strong>
              <span>{m.fileName} · {formatBytes(m.size)}{m.pages ? ` · ${pageCount(m)}` : ''} · {formatDate(m.createdAt)}</span>
              {m.status === 'ready' && <div className="term-chips">{Object.keys(m.terms).slice(0, 5).map(t => <span key={t}>#{t}</span>)}</div>}
            </div>
            <StatusPill m={m} />
            <select aria-label={`Subject for ${m.title}`} value={m.subjectId} onChange={e => patch(m.id, { subjectId: e.target.value })}><option value="">No subject</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.code}</option>)}</select>
            <div className="row-actions">
              {m.status === 'ready' && <button className="icon-button" aria-label={`Show ${m.title} in graph`} title="Show in graph" onClick={() => { setSelectedId(m.id); setView('graph') }}><Network /></button>}
              <button className="icon-button" aria-label={`Open ${m.title}`} title="Open file" onClick={() => open(m)}><ExternalLink /></button>
              <button className="icon-button danger" aria-label={`Remove ${m.title}`} title="Remove" onClick={() => remove(m.id)}><Trash2 /></button>
            </div>
          </li>)}</ul>}
      </> : <section className="graph-view">
        <div className="graph-toolbar">
          <label className="graph-search"><Search /><input placeholder="Search files and topics" value={query} onChange={e => setQuery(e.target.value)} /></label>
          <label className="toggle-chip"><input type="checkbox" checked={showSubjects} onChange={e => setShowSubjects(e.target.checked)} /> Subjects</label>
          <label className="toggle-chip"><input type="checkbox" checked={showTopics} onChange={e => setShowTopics(e.target.checked)} /> Shared topics</label>
          <button className="toggle-chip" onClick={() => setFitSignal(n => n + 1)}><Maximize2 /> Fit</button>
        </div>
        <div className="graph-stage">
          {ready.length === 0
            ? <div className="empty-materials"><Network /><strong>Nothing to map yet</strong><span>Upload materials and your graph will appear here once they&apos;re read.</span><button className="outline-button" onClick={() => setView('materials')}>Upload materials</button></div>
            : <KnowledgeGraph nodes={graph.nodes} links={graph.links} selectedId={selectedId} query={query} onSelect={setSelectedId} fitSignal={fitSignal} />}
          <div className="graph-legend" aria-label="Legend">
            {(['pdf', 'pptx', 'docx'] as Format[]).map(f => <span key={f}><i style={{ background: NODE_COLORS[f] }} />{FORMAT_LABEL[f]}</span>)}
            <span><i style={{ background: NODE_COLORS.subject }} />Subject</span>
            <span><i style={{ background: NODE_COLORS.topic }} />Topic</span>
          </div>
          {ready.length === 1 && <p className="graph-hint">Upload more files to see how they connect.</p>}
        </div>

        {selectedId && <aside className="node-panel" aria-label="Selection details">
          <button className="icon-button close" aria-label="Close details" onClick={() => setSelectedId(null)}><X /></button>
          {selectedMaterial && <>
            <FormatBadge format={selectedMaterial.format} />
            <h2>{selectedMaterial.title}</h2>
            <p className="muted">{subjectOf(selectedMaterial.subjectId)?.code}{selectedMaterial.pages ? ` · ${pageCount(selectedMaterial)}` : ''}</p>
            <h3>Main topics</h3>
            <div className="term-chips">{Object.keys(selectedMaterial.terms).slice(0, 10).map(t => <button key={t} onClick={() => setSelectedId(topicNodeId(t))}>#{t}</button>)}</div>
            <h3>Connected files ({related.length})</h3>
            {related.length ? <ul className="related-list">{related.map(r => <li key={r.other.id}><button onClick={() => setSelectedId(r.other.id)}><strong>{r.other.title}</strong><span>{Math.round(r.score * 100)}% overlap · {r.shared.slice(0, 3).join(', ')}</span></button></li>)}</ul> : <p className="muted">No strong overlap with your other files yet.</p>}
            <h3>Preview</h3><p className="excerpt">{selectedMaterial.excerpt}…</p>
            <button className="outline-button" onClick={() => open(selectedMaterial)}><ExternalLink /> Open file</button>
          </>}
          {selectedTopic && <>
            <h2>#{selectedTopic}</h2>
            <p className="muted">Files that cover this topic</p>
            <ul className="related-list">{ready.filter(m => selectedTopic in m.terms).map(m => <li key={m.id}><button onClick={() => setSelectedId(m.id)}><strong>{m.title}</strong><span>{subjectOf(m.subjectId)?.code} · {FORMAT_LABEL[m.format]}</span></button></li>)}</ul>
          </>}
          {selectedSubject && <>
            <h2>{selectedSubject.code}</h2>
            <p className="muted">{selectedSubject.title}</p>
            <ul className="related-list">{ready.filter(m => m.subjectId === selectedSubject.id).map(m => <li key={m.id}><button onClick={() => setSelectedId(m.id)}><strong>{m.title}</strong><span>{FORMAT_LABEL[m.format]}</span></button></li>)}</ul>
          </>}
        </aside>}
      </section>}
    </main>
    <ScribeWidget user={user} mode="instructor" />
  </div>
}
