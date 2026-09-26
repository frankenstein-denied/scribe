'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, ExternalLink, FileText, ListChecks, Loader2, Menu, Send, X } from 'lucide-react'
import { StudentSidebar } from '@/components/student/sidebar'
import { ScribeAvatar } from '@/components/scribe/avatar'
import { ThemeToggle } from '@/components/theme-toggle'
import { signOut, useSession } from '@/lib/session'
import { loadLibrary, type Library, type Passage } from '@/lib/library'
import { loadFile } from '@/lib/materials'
import { buildIndex, queryTerms, stem } from '@/lib/retrieval'
import { respond } from '@/lib/assistant'
import { makeQuestions, QUIZ_KINDS, suggestTitle, type QuizKind } from '@/lib/quiz'
import { listSets, MAX_STUDY_SETS, putSet, type SavedStudySet } from '@/lib/studysets'
import { archive, archiveOpenChat, chatKey, deleteChat, listChats, persistArchive, readCurrent, type ChatCell, type ChatPart, type ChatTurn, type RecentChat } from '@/lib/recents'
import { termCounts, words } from '@/lib/topics'
import { subjects, type User } from '@/types'
import { Analytics } from "@vercel/analytics/next"  
import './student.css'

type Cell = ChatCell
type Part = ChatPart
type Turn = ChatTurn

const cite = (p: Passage) => [p.subjectCode, p.page ? `${p.format === 'pptx' ? 'slide' : 'p.'}${p.format === 'pptx' ? ' ' : ''}${p.page}` : null].filter(Boolean).join(' · ')

/** Marks the words of `text` that match the question's terms. Keeps the author's line breaks. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return <>{text.split(/([A-Za-z][\w'-]*)/).map((piece, i) => {
    const w = words(piece)[0]
    return w && terms.includes(stem(w)) ? <mark key={i}>{piece}</mark> : <Fragment key={i}>{piece}</Fragment>
  })}</>
}

const FORMAT_LABEL = { pdf: 'PDF', pptx: 'Slides', docx: 'Word' } as const
const shortDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')

function NotebookCell({ cell, n, terms, selecting, selected, onToggle, onSource, onAction }: {
  cell: Cell; n: number; terms: string[]; selecting: boolean; selected: boolean; onToggle: () => void; onSource: () => void; onAction: (request: string) => void
}) {
  const p = cell.passage
  const kind = cell.kind ?? 'passage'
  return <div className={`nb-cell kind-${kind} ${selecting ? 'selecting' : ''} ${selected ? 'selected' : ''}`} onClick={selecting ? onToggle : undefined}>
    <div className="nb-gutter">
      {selecting
        ? <input type="checkbox" checked={selected} onChange={onToggle} onClick={e => e.stopPropagation()} aria-label={`Include cell ${n} in quiz`} />
        : <span aria-label={`Cell ${n}`}>[{n}]</span>}
    </div>
    <div className="nb-body">
      {kind === 'material' && <>
        <div className="nb-file-head"><span className="nb-format">{FORMAT_LABEL[p.format]}</span><strong>{cell.heading}</strong></div>
        <p className="nb-file-meta">{[p.subjectCode, cell.meta?.pages ? `${cell.meta.pages} ${p.format === 'pptx' ? 'slide' : 'page'}${cell.meta.pages === 1 ? '' : 's'}` : '', p.profName, cell.meta?.uploadedAt ? `uploaded ${shortDate(cell.meta.uploadedAt)}` : ''].filter(Boolean).join(' · ')}</p>
        {!!cell.meta?.topics?.length && <div className="term-chips">{cell.meta.topics.map(t => <span key={t}>#{t}</span>)}</div>}
        <div className="nb-text nb-preview">{cell.excerpt}</div>
        {!selecting && <div className="nb-actions">
          <button className="outline-button" onClick={() => onAction(`summarize the ${cell.heading} file`)}>Summarize</button>
          <button className="outline-button" onClick={() => onAction(`make a reviewer from the ${cell.heading} file`)}>Make reviewer</button>
          <button className="outline-button" onClick={() => onAction(`quiz me on the ${cell.heading} file`)}>Quiz me</button>
        </div>}
      </>}
      {kind === 'term' && <div className="nb-text"><strong className="nb-term">{cell.heading}</strong><Highlighted text={cell.excerpt} terms={terms} /></div>}
      {kind === 'list' && <div className="nb-text"><strong className="nb-term">{cell.heading}</strong><ul className="nb-list">{cell.excerpt.split('\n').map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
      {kind === 'passage' && <div className="nb-text"><Highlighted text={cell.excerpt} terms={terms} /></div>}
      {kind !== 'material' && <div className="nb-source">
        <FileText /><span><strong>{p.title}</strong>{[cite(p), p.profName].filter(Boolean).map(s => ` · ${s}`).join('')}</span>
        {!selecting && <button className="text-button" onClick={onSource}>View source</button>}
      </div>}
    </div>
  </div>
}

function SourcePanel({ cell, terms, onClose }: { cell: Cell; terms: string[]; onClose: () => void }) {
  const [note, setNote] = useState('')
  const p = cell.passage
  const open = async () => {
    const blob = await loadFile(p.materialId)
    if (blob) window.open(URL.createObjectURL(blob) + (p.format === 'pdf' && p.page ? `#page=${p.page}` : ''), '_blank', 'noopener')
    else setNote('The original file is only on your instructor’s computer. The full passage is shown above.')
  }
  return <aside className="source-panel" aria-label="Source details">
    <div className="source-head"><div><h2>{p.title}</h2><p>{[cite(p), p.profName].filter(Boolean).join(' · ')}</p></div><button className="icon-button" onClick={onClose} aria-label="Close source"><X /></button></div>
    <div className="source-body"><p>Full passage from {p.fileName}</p><blockquote className="nb-text"><Highlighted text={p.text} terms={terms} /></blockquote></div>
    <div className="source-foot">{note && <p className="source-note">{note}</p>}<button className="outline-button" onClick={open}><ExternalLink /> Open {p.format.toUpperCase()}{p.page && p.format === 'pdf' ? ` at page ${p.page}` : ''}</button></div>
  </aside>
}

export default function Page() {
  const router = useRouter()
  const user = useSession()
  const [setsUsed, setSetsUsed] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const [library, setLibrary] = useState<Library | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [chatId, setChatId] = useState<string | null>(null)
  const [recents, setRecents] = useState<RecentChat[]>([])
  const [input, setInput] = useState('')
  const [scope, setScope] = useState<string | null>(null)
  const [running, setRunning] = useState<{ turnId: string; shown: number } | null>(null)
  const [source, setSource] = useState<{ cell: Cell; terms: string[] } | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<{ title: string; kind: QuizKind; error: string } | null>(null)
  const [toast, setToast] = useState<{ text: string; setId?: string; error?: boolean } | null>(null)
  const [creating, setCreating] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  const uid = user?.uid
  useEffect(() => {
    if (!uid) return
    let current = readCurrent(uid)
    setChatId(current.id); setTurns(current.turns)
    loadLibrary().then(setLibrary).catch(() => setToast({ text: 'Couldn’t load course materials. Check your connection and reload.', error: true }))
    listChats(uid).then(async list => {
      // Opened from a Recents link on another page (/?chat=<id>).
      const wanted = new URLSearchParams(window.location.search).get('chat')
      const target = wanted && wanted !== current.id ? list.find(c => c.id === wanted) : undefined
      if (target) {
        const filed = archive(list, current.id, current.turns)
        await persistArchive(uid, filed)
        list = filed.list
        current = { id: target.id, turns: target.turns }
        setChatId(current.id); setTurns(current.turns)
      }
      if (wanted) window.history.replaceState(null, '', '/')
      setRecents(list)
    }).catch(() => {})
  }, [uid])

  useEffect(() => { if (uid) try { sessionStorage.setItem(chatKey(uid), JSON.stringify({ id: chatId, turns })) } catch {} }, [turns, chatId, uid])

  // /?ask=… comes from the SCRIBE companion on other dashboards: ask it here once the materials are ready.
  const pendingAsk = useRef<string | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('ask')
    if (q) { pendingAsk.current = q; window.history.replaceState(null, '', '/') }
  }, [])

  const index = useMemo(() => (library ? buildIndex(library.passages) : null), [library])
  // Starter requests built from what's actually uploaded, showing off what SCRIBE understands.
  const suggestions = useMemo(() => {
    if (!library?.materials.length) return []
    const counts = termCounts(library.passages.map(p => p.text).join('\n'), 40)
    const phrases = Object.keys(counts).filter(t => t.includes(' '))
    const topic = phrases[0] ?? Object.keys(counts)[0]
    const byOwner = new Map<string, number>()
    for (const m of library.materials) byOwner.set(m.ownerName, (byOwner.get(m.ownerName) ?? 0) + 1)
    const owner = [...byOwner].sort((a, b) => b[1] - a[1])[0][0]
    const newest = [...library.materials].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    return [
      { q: `Make a reviewer on ${topic}`, code: 'Reviewer' },
      { q: `Give me everything Prof. ${owner.split(' ')[0]} uploaded`, code: 'Browse files' },
      { q: `Summarize the ${newest.title} file`, code: 'Summary' },
      { q: `Quiz me on ${phrases[1] ?? topic}`, code: 'Quiz' },
    ]
  }, [library])

  // Cells are numbered across the whole conversation, like a notebook's execution counts.
  const numbering = useMemo(() => {
    const map = new Map<string, number>()
    let n = 0
    for (const t of turns) for (const p of t.parts) for (const c of p.cells) map.set(c.id, ++n)
    return map
  }, [turns])
  const allCells = useMemo(() => turns.flatMap(t => t.parts.flatMap(p => p.cells.map(cell => ({ cell, part: p })))), [turns])

  const scrollDown = () => requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }))

  /** Opens "Name your quiz" with the given cells already ticked ("quiz me on …"). */
  const openQuizFor = (cells: Cell[]) => {
    setSelecting(true); setSelected(new Set(cells.map(c => c.id))); setSource(null)
    setDialog({ title: suggestTitle(cells.map(c => ({ text: c.excerpt, passage: c.passage }))), kind: 'multiple-choice', error: '' })
    if (uid) listSets(uid).then(s => setSetsUsed(s.length)).catch(() => {})
  }

  const ask = (question: string) => {
    if (!question.trim() || !index || !library || running) return
    const id = `t-${Date.now()}`
    // The NLP layer works out what's being asked for (answer, reviewer, file list, summary, comparison, quiz…).
    const reply = respond(question, library, index, scope, user?.role === 'Professor' ? user.name : undefined)
    const parts: Part[] = reply.parts.map((part, pi) => ({
      label: part.label, query: part.query,
      cells: part.cells.map((c, ci) => ({ ...c, id: `${id}-${pi}-${ci}` })),
    }))
    setTurns(prev => [...prev, { id, question: question.trim(), scope, parts, intent: reply.intent, note: reply.note }])
    // A chat gets its id on the first question, so quizzes made from it can point back to it.
    if (!chatId) setChatId(crypto.randomUUID())
    setInput('')
    // Reveal cells one at a time, like a notebook running.
    const total = parts.reduce((a, p) => a + Math.max(p.cells.length, 1), 0)
    setRunning({ turnId: id, shown: 0 })
    let shown = 0
    // Long answers (reviewers, file lists) reveal faster so they don't drag.
    const timer = window.setInterval(() => {
      shown++
      setRunning(shown >= total ? null : { turnId: id, shown })
      scrollDown()
      if (shown >= total) {
        window.clearInterval(timer)
        if (reply.autoQuiz) openQuizFor(parts.flatMap(p => p.cells))
      }
    }, total > 8 ? 90 : 220)
    scrollDown()
  }

  useEffect(() => {
    if (!pendingAsk.current || !index || !library || running) return
    const q = pendingAsk.current
    pendingAsk.current = null
    ask(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, library, running])

  const clearView = () => { setInput(''); setScope(null); setSelecting(false); setSelected(new Set()); setSource(null); setDialog(null) }

  const saveFailed = () => setToast({ text: 'Couldn’t save to your account. Check your connection; your chat is still here.', error: true })

  /** Files the open conversation into Recents (locally right away, then in Firestore). */
  const fileCurrent = () => {
    if (!uid) return
    const filed = archive(recents, chatId, turns)
    setRecents(filed.list)
    persistArchive(uid, filed).catch(saveFailed)
  }

  // New chat: the current conversation goes to Recents, then the page starts fresh.
  const reset = () => { fileCurrent(); setTurns([]); setChatId(null); clearView() }

  const openRecent = (id: string) => {
    const target = recents.find(c => c.id === id)
    if (!target || id === chatId) return
    fileCurrent()
    setTurns(target.turns); setChatId(target.id); clearView()
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: 0 }))
  }

  const deleteRecent = (id: string) => {
    if (!uid) return
    setRecents(list => list.filter(c => c.id !== id))
    deleteChat(uid, id).catch(saveFailed)
    if (id === chatId) { setTurns([]); setChatId(null); clearView() }
  }

  // Logging out also files the open conversation, so it isn't lost with the tab.
  const logout = async () => {
    if (uid) await archiveOpenChat(uid).catch(() => {})
    await signOut()
    router.replace('/login')
  }
  const toggle = (id: string) => setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

  const startQuiz = () => {
    const sources = allCells.filter(({ cell }) => selected.has(cell.id)).map(({ cell }) => ({ text: cell.excerpt, passage: cell.passage }))
    setDialog({ title: suggestTitle(sources), kind: 'multiple-choice', error: '' })
    if (uid) listSets(uid).then(s => setSetsUsed(s.length)).catch(() => {})
  }

  const createQuiz = async () => {
    if (!uid || !dialog || creating) return
    const title = dialog.title.trim()
    if (!title) return setDialog({ ...dialog, error: 'Give your quiz a title.' })
    setCreating(true)
    let count: number
    try { count = (await listSets(uid)).length } catch { setCreating(false); return setDialog({ ...dialog, error: 'Couldn’t reach the server. Check your connection and try again.' }) }
    setSetsUsed(count)
    if (count >= MAX_STUDY_SETS) { setCreating(false); return setDialog({ ...dialog, error: `You already have ${MAX_STUDY_SETS} study sets. Delete one in Study sets to make room.` }) }
    const chosen = allCells.filter(({ cell }) => selected.has(cell.id)).map(({ cell }) => cell)
    const items = makeQuestions(chosen.map(c => ({ text: c.excerpt, passage: c.passage })), { kind: dialog.kind })
    if (!items.length) {
      setCreating(false)
      return setDialog({ ...dialog, error: dialog.kind === 'enumeration'
        ? 'These cells don’t contain any lists to enumerate. Select cells that list several items, or pick another quiz type.'
        : 'These cells don’t have enough full sentences to make questions. Select a few more cells.' })
    }
    const set: SavedStudySet = {
      id: crypto.randomUUID(), title, kind: dialog.kind, createdAt: new Date().toISOString(), items, sourceCount: chosen.length,
      subjectCodes: [...new Set(chosen.map(c => c.passage.subjectCode).filter(Boolean))], review: {}, attempts: 0, history: [],
      sourceChatId: chatId ?? undefined,
    }
    try {
      await putSet(uid, set)
    } catch {
      setCreating(false)
      return setDialog({ ...dialog, error: 'Couldn’t save the quiz. Check your connection and try again.' })
    }
    setCreating(false)
    setDialog(null); setSelecting(false); setSelected(new Set())
    setToast({ text: `“${title}” saved to Study sets with ${items.length} question${items.length === 1 ? '' : 's'}.`, setId: set.id })
  }

  if (!user) return null
  const ready = !!library
  const empty = ready && library.materialCount === 0
  const scopeSubjects = subjects.filter(s => library?.subjectIds.includes(s.id))

  return <div className="app-shell">
    <StudentSidebar user={user} active="ask" collapsed={collapsed} setCollapsed={setCollapsed} onNew={reset} onLogout={logout}
      recents={recents} activeChatId={chatId} onOpenRecent={openRecent} onDeleteRecent={deleteRecent} />
    <main className="chat-main">
      <header className="mobile-header"><button className="icon-button" aria-label="Open sidebar" onClick={() => setCollapsed(false)}><Menu /></button><span className="brand">SCRIBE</span><ThemeToggle compact /></header>
      <div className="chat-scroll" ref={scroller}>
        {turns.length === 0
          ? <section className="empty-state">
            <div className="scribe-hello">
              <ScribeAvatar size={220} />
              <div className="speech left"><strong>Hello {user.firstName}, I’m SCRIBE!</strong>What can I do for you today?</div>
            </div>
            <p>{!ready ? 'Give me a moment, I’m getting your course materials…' : empty ? 'Your instructors haven’t uploaded anything yet. Once they do, I can answer from their files.' : `I answer straight from the ${library.materialCount} file${library.materialCount === 1 ? '' : 's'} your CICT instructors uploaded, and I’ll always show you the page it came from.`}</p>
          </section>
          : <div className="conversation">{turns.map(turn => {
            const isRunning = running?.turnId === turn.id
            let revealed = 0
            return <Fragment key={turn.id}>
              <div className="message-row user"><div className="message-content"><div className="user-bubble">{turn.question}</div>{turn.scope && <small className="scope-note">Only {subjects.find(s => s.id === turn.scope)?.code}</small>}</div></div>
              <div className="message-row assistant">
                <ScribeAvatar badge size={34} />
                <div className="message-content notebook">
                  {turn.note && <p className="nb-note speech">{turn.note}</p>}
                  {turn.parts.map((part, pi) => {
                    const terms = queryTerms(part.query)
                    const multi = turn.parts.length > 1
                    const plainAnswer = !turn.intent || turn.intent === 'ask'
                    return <section key={pi} className="nb-part" aria-label={part.label}>
                      {(multi || !plainAnswer) && <h3 className="nb-heading">{plainAnswer && <span>Part {pi + 1} of {turn.parts.length}</span>}{part.label}</h3>}
                      {part.cells.length === 0
                        ? (!isRunning || revealed++ < running.shown) && <div className="nb-cell empty"><div className="nb-gutter"><span>[ ]</span></div><div className="nb-body"><AlertCircle /><div><strong>No uploaded material covers {multi ? 'this part' : 'this'} yet.</strong><span>{empty ? 'Your instructors haven’t uploaded any files yet.' : 'Try different words, or ask your instructor to upload a file on it.'}</span></div></div></div>
                        : part.cells.map(cell => {
                          if (isRunning && revealed++ >= running.shown) return revealed === running.shown + 1 ? <div key={cell.id} className="nb-cell pending"><div className="nb-gutter"><span>[*]</span></div><div className="nb-body"><Loader2 className="spin" /> Searching your materials…</div></div> : null
                          return <NotebookCell key={cell.id} cell={cell} n={numbering.get(cell.id)!} terms={terms} selecting={selecting} selected={selected.has(cell.id)} onToggle={() => toggle(cell.id)} onSource={() => setSource({ cell, terms })} onAction={ask} />
                        })}
                    </section>
                  })}
                </div>
              </div>
            </Fragment>
          })}</div>}
      </div>

      <div className="composer-wrap">
        {toast && <div className={`chat-toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <AlertCircle /> : <CheckCircle2 />}<span>{toast.text}</span>{toast.setId && <Link className="text-button" href={`/study-sets?open=${toast.setId}`}>Open quiz</Link>}<button className="icon-button" aria-label="Dismiss" onClick={() => setToast(null)}><X /></button></div>}
        {allCells.length > 0 && !running && (selecting
          ? <div className="quiz-bar selecting">
            <span><strong>{selected.size}</strong> of {allCells.length} cells selected</span>
            <button className="text-button" onClick={() => setSelected(selected.size === allCells.length ? new Set() : new Set(allCells.map(c => c.cell.id)))}>{selected.size === allCells.length ? 'Clear all' : 'Select all'}</button>
            <span className="spacer" />
            <button className="outline-button" onClick={() => { setSelecting(false); setSelected(new Set()) }}>Cancel</button>
            <button className="primary-button" disabled={!selected.size} onClick={startQuiz}>Next: name quiz</button>
          </div>
          : <div className="quiz-bar">
            <span>Turn these answers into a quiz</span>
            <span className="spacer" />
            <button className="outline-button" onClick={() => { setSelecting(true); setSource(null); setToast(null) }}><ListChecks /> Create quiz</button>
          </div>)}
        {selecting && <p className="quiz-hint">Tick the cells to include. Questions are made only from the text in those cells.</p>}
        {!selecting && <>
          <div className={`composer ${!ready || empty ? 'disabled' : ''}`}>
            <textarea value={input} disabled={!ready || empty} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(input) } }} placeholder={empty ? 'No materials to ask about yet' : 'Ask a question, or try “make a reviewer on…”, “everything Prof. … uploaded”, “summarize…”, “quiz me on…”'} rows={1} aria-label="Question" />
            {scopeSubjects.length > 1 && <select className="scope-select" value={scope ?? ''} onChange={e => setScope(e.target.value || null)} aria-label="Limit to a subject"><option value="">All subjects</option>{scopeSubjects.map(s => <option key={s.id} value={s.id}>{s.code}</option>)}</select>}
            <button className="send-button" onClick={() => ask(input)} disabled={!input.trim() || !!running || !ready} aria-label="Send message"><Send /></button>
          </div>
          {turns.length === 0 && suggestions.length > 0 && <div className="suggestions">{suggestions.map(s => <button key={s.q} onClick={() => ask(s.q)}><span>{s.q}</span><small>{s.code}</small></button>)}</div>}
          <p className="footer-note">SCRIBE only answers from uploaded CICT materials. Each cell shows the exact passage and page it came from.</p>
        </>}
      </div>
    </main>
    {source && !selecting && <SourcePanel cell={source.cell} terms={source.terms} onClose={() => setSource(null)} />}

    {dialog && <div className="modal-backdrop" onClick={() => setDialog(null)}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="quiz-title" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); createQuiz() }}>
        <h2 id="quiz-title">Name your quiz</h2>
        <p>Made from {selected.size} selected cell{selected.size === 1 ? '' : 's'}. It will be saved to your Study sets.</p>
        <label>Quiz title<input autoFocus maxLength={80} value={dialog.title} onChange={e => setDialog({ ...dialog, title: e.target.value, error: '' })} /></label>
        <fieldset className="kind-picker">
          <legend>Quiz type</legend>
          {QUIZ_KINDS.map(k => <label key={k.kind} className={dialog.kind === k.kind ? 'selected' : ''}>
            <input type="radio" name="quiz-kind" value={k.kind} checked={dialog.kind === k.kind} onChange={() => setDialog({ ...dialog, kind: k.kind, error: '' })} />
            <span><strong>{k.label}</strong><small>{k.hint}</small></span>
          </label>)}
        </fieldset>
        <p className={`sets-count ${setsUsed >= MAX_STUDY_SETS ? 'full' : ''}`}>Study sets used: {setsUsed} of {MAX_STUDY_SETS}</p>
        {dialog.error && <p className="field-error" role="alert"><AlertCircle /> {dialog.error}</p>}
        <div className="modal-actions">
          <button type="button" className="outline-button" onClick={() => setDialog(null)}>Back</button>
          <button type="submit" className="primary-button" disabled={setsUsed >= MAX_STUDY_SETS || creating}>{creating ? 'Generating…' : 'Generate quiz'}</button>
        </div>
        {setsUsed >= MAX_STUDY_SETS && <Link className="text-button" href="/study-sets">Manage study sets</Link>}
      </form>
    </div>}
  </div>
}

export const dynamic = 'force-static'
