'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Brain, Flame, Loader2, Maximize2, Menu, Search, Target, Trophy, X } from 'lucide-react'
import { StudentSidebar } from '@/components/student/sidebar'
import { ThemeToggle } from '@/components/theme-toggle'
import type { NetLink, NetNode } from '@/components/graph/network-graph'
import { signOut, useSession } from '@/lib/session'
import { ScribeWidget } from '@/components/scribe/assistant-widget'
import { archiveOpenChat, deleteChat, listChats, readCurrent, type ChatTurn, type RecentChat } from '@/lib/recents'
import { listSets, type SavedStudySet } from '@/lib/studysets'
import { attemptsOf, brainStats, buildBrain, PASS_MARK, sourceNodeId, STATUS_LABEL, type BrainNode, type QuizStatus } from '@/lib/brain'
import '../instructor/dashboard.css'
import '../student.css'

// Canvas + d3 only work in the browser.
const NetworkGraph = dynamic(() => import('@/components/graph/network-graph'), { ssr: false, loading: () => <div className="graph-canvas graph-loading"><Loader2 className="spin" /></div> })

const COLORS = { session: '#5B7FC7', source: '#8C5A64', passed: '#2F9E5B', retook: '#D9A21B', failed: '#D64545', untaken: '#9A9092' } as const
const statusColor = (s: QuizStatus) => COLORS[s]
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const pct = (c: number, t: number) => (t ? Math.round((c / t) * 100) : 0)

function toNetwork(nodes: BrainNode[], links: ReturnType<typeof buildBrain>['links']): { nodes: NetNode[]; links: NetLink[] } {
  return {
    nodes: nodes.map(n => n.kind === 'session'
      ? { id: n.id, label: n.label, color: COLORS.session, radius: 4 + Math.sqrt(n.questions) * 1.6, ring: n.current ? COLORS.session : undefined }
      : n.kind === 'quiz'
        ? { id: n.id, label: n.label, color: statusColor(n.status), radius: 5 + Math.min(n.set.items.length, 15) * 0.25 }
        : { id: n.id, label: n.label, color: COLORS.source, radius: 8, hub: true }),
    links: links.map(l => l.kind === 'made-from'
      ? { source: l.source, target: l.target, width: 2, distance: 40, strong: true }
      : l.kind === 'uses'
        ? { source: l.source, target: l.target, width: 0.8, distance: 55, dashed: true }
        : { source: l.source, target: l.target, width: 0.6 + l.weight * 0.6, distance: 65 }),
  }
}

export default function BrainPage() {
  const router = useRouter()
  const user = useSession()
  const uid = user?.uid
  const [collapsed, setCollapsed] = useState(false)
  const [chats, setChats] = useState<RecentChat[]>([])
  const [sets, setSets] = useState<SavedStudySet[]>([])
  const [current, setCurrent] = useState<{ id: string | null; turns: ChatTurn[] }>({ id: null, turns: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showSources, setShowSources] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fitSignal, setFitSignal] = useState(0)

  useEffect(() => {
    if (!uid) return
    setCurrent(readCurrent(uid))
    Promise.all([listChats(uid), listSets(uid)])
      .then(([c, s]) => { setChats(c); setSets(s) })
      .catch(() => setError('Couldn’t load your study history. Check your connection and reload.'))
      .finally(() => setLoading(false))
  }, [uid])

  const input = useMemo(() => ({ chats, current, sets }), [chats, current, sets])
  const brain = useMemo(() => buildBrain(input, { showSources }), [input, showSources])
  const network = useMemo(() => toNetwork(brain.nodes, brain.links), [brain])
  const stats = useMemo(() => brainStats(input), [input])
  // The panel always has the source hubs to hand, even when they're hidden from the graph.
  const full = useMemo(() => buildBrain(input, { showSources: true }), [input])

  const logout = async () => { if (uid) await archiveOpenChat(uid).catch(() => {}); await signOut(); router.replace('/login') }
  if (!user) return null

  const selected = full.nodes.find(n => n.id === selectedId)
  const empty = !loading && !full.nodes.length
  const byId = (id: string) => full.nodes.find(n => n.id === id)
  const usersOf = (sourceId: string) => full.nodes.filter((n): n is Exclude<BrainNode, { kind: 'source' }> => n.kind !== 'source' && n.sources.includes(sourceId))
  // A row in the details panel that jumps to another node. A plain function (not a component) so rows aren't remounted.
  const nodeLink = (id: string) => {
    const n = byId(id)
    if (!n) return null
    const dot = n.kind === 'quiz' ? statusColor(n.status) : n.kind === 'session' ? COLORS.session : COLORS.source
    return <li key={id}><button onClick={() => setSelectedId(id)}><i style={{ background: dot }} /><span><strong>{n.label}</strong>
      <small>{n.kind === 'quiz' ? STATUS_LABEL[n.status] : n.kind === 'session' ? `${n.questions} question${n.questions === 1 ? '' : 's'} · ${formatDate(n.at)}` : n.source.subjectCode || 'Source file'}</small></span></button></li>
  }

  return <div className="app-shell">
    <StudentSidebar user={user} active="brain" collapsed={collapsed} setCollapsed={setCollapsed} onLogout={logout}
      recents={chats} onOpenRecent={id => router.push(`/?chat=${id}`)}
      onDeleteRecent={id => { setChats(list => list.filter(c => c.id !== id)); if (uid) deleteChat(uid, id).catch(() => {}) }} />
    <main className="sets-main brain-main">
      <header className="mobile-header"><button className="icon-button" aria-label="Open sidebar" onClick={() => setCollapsed(false)}><Menu /></button><span className="brand">SCRIBE</span><ThemeToggle compact /></header>
      <div className="sets-head"><div><h1>My 2nd brain</h1><p>Every study session and quiz becomes a node. Anything that came from the same file is connected.</p></div></div>
      {error && <p className="field-error" role="alert">{error}</p>}

      <section className="motivation" aria-label="Your progress">
        <div className={`streak ${stats.streak.days ? 'on' : ''}`}>
          <Flame /><div><strong>{stats.streak.days}-day streak</strong>
            <span>{stats.streak.today ? 'You studied today. Keep it going tomorrow.' : stats.streak.days ? 'Study today to keep your streak alive.' : 'Ask SCRIBE something today to start a streak.'}</span></div>
        </div>
        <div><Brain /><div><strong>{stats.sessions} session{stats.sessions === 1 ? '' : 's'}</strong><span>{stats.questions} question{stats.questions === 1 ? '' : 's'} asked</span></div></div>
        <div><Trophy /><div><strong>{stats.passed} of {stats.taken} quizzes passed</strong><span>{stats.passRate === null ? 'Take a quiz to see your pass rate' : `${stats.passRate}% pass rate · pass mark ${PASS_MARK * 100}%`}</span></div></div>
        <div className="next-up"><Target /><div>
          <strong>{stats.next ? (stats.next.kind === 'retake' ? 'Next: turn a red node green' : 'Next: take your new quiz') : stats.quizzes ? 'All caught up' : 'Next: make your first quiz'}</strong>
          <span>{stats.next ? stats.next.set.title : stats.quizzes ? 'Every quiz is passed. Ask about a new topic to grow your brain.' : 'Ask SCRIBE, then use Create quiz.'}</span>
        </div>{stats.next
          ? <Link className="primary-button" href={`/study-sets?open=${stats.next.set.id}`}>{stats.next.kind === 'retake' ? 'Retake' : 'Start'}</Link>
          : <Link className="outline-button" href="/">Ask SCRIBE</Link>}</div>
      </section>

      <section className="graph-view">
        <div className="graph-toolbar">
          <label className="graph-search"><Search /><input placeholder="Search sessions, quizzes, files" value={query} onChange={e => setQuery(e.target.value)} /></label>
          <label className="toggle-chip"><input type="checkbox" checked={showSources} onChange={e => setShowSources(e.target.checked)} /> Source files</label>
          <button className="toggle-chip" onClick={() => setFitSignal(n => n + 1)}><Maximize2 /> Fit</button>
        </div>
        <div className="graph-stage">
          {loading ? <div className="graph-canvas graph-loading"><Loader2 className="spin" /></div>
            : empty ? <div className="empty-materials"><Brain /><strong>Your 2nd brain is empty</strong><span>Each question session and quiz you make adds a node here. Start by asking SCRIBE something.</span><Link className="outline-button" href="/">Ask SCRIBE</Link></div>
              : <NetworkGraph nodes={network.nodes} links={network.links} selectedId={selectedId} query={query} onSelect={setSelectedId} fitSignal={fitSignal} charge={-110} />}
          <div className="graph-legend" aria-label="Legend">
            <span><i style={{ background: COLORS.session }} />Session</span>
            <span><i style={{ background: COLORS.passed }} />Passed</span>
            <span><i style={{ background: COLORS.retook }} />Passed after retake</span>
            <span><i style={{ background: COLORS.failed }} />Not passed</span>
            <span><i style={{ background: COLORS.untaken }} />Not taken</span>
            {showSources && <span><i style={{ background: COLORS.source }} />Source file</span>}
          </div>
        </div>

        {selected && <aside className="node-panel" aria-label="Selection details">
          <button className="icon-button close" aria-label="Close details" onClick={() => setSelectedId(null)}><X /></button>
          {selected.kind === 'session' && <>
            <span className="kind-chip">{selected.current ? 'Current session' : 'Session'}</span>
            <h2>{selected.label}</h2>
            <p className="muted">{selected.questions} question{selected.questions === 1 ? '' : 's'} · {formatDate(selected.at)}</p>
            <h3>Quizzes made from it</h3>
            {full.nodes.some(n => n.kind === 'quiz' && n.sessionId === selected.id)
              ? <ul className="brain-list">{full.nodes.filter(n => n.kind === 'quiz' && n.sessionId === selected.id).map(n => nodeLink(n.id))}</ul>
              : <p className="muted">None yet. Open the chat and use Create quiz.</p>}
            <h3>Source files</h3>
            <ul className="brain-list">{selected.sources.map(m => nodeLink(sourceNodeId(m)))}</ul>
            <Link className="outline-button" href={selected.current ? '/' : `/?chat=${selected.chatId}`}>Open this chat</Link>
          </>}
          {selected.kind === 'quiz' && <>
            <span className="kind-chip" style={{ color: statusColor(selected.status) }}>{STATUS_LABEL[selected.status]}</span>
            <h2>{selected.label}</h2>
            <p className="muted">{selected.set.items.length} questions · made {formatDate(selected.at)}</p>
            <h3>Attempts</h3>
            {attemptsOf(selected.set).length
              ? <ol className="attempts">{attemptsOf(selected.set).map((a, i) => <li key={i} className={a.total && a.correct / a.total >= PASS_MARK ? 'pass' : 'fail'}>
                <span>{a.correct}/{a.total}</span><span>{pct(a.correct, a.total)}%</span><span>{a.at ? formatDate(a.at) : ''}</span></li>)}</ol>
              : <p className="muted">Not taken yet.</p>}
            {selected.sessionId && <><h3>Made from</h3><ul className="brain-list">{nodeLink(selected.sessionId)}</ul></>}
            <h3>Source files</h3>
            <ul className="brain-list">{selected.sources.map(m => nodeLink(sourceNodeId(m)))}</ul>
            <Link className="primary-button" href={`/study-sets?open=${selected.set.id}`}>{selected.status === 'untaken' ? 'Take quiz' : 'Retake quiz'}</Link>
          </>}
          {selected.kind === 'source' && (() => {
            const users = usersOf(selected.source.id)
            const quizzes = users.filter((n): n is Extract<BrainNode, { kind: 'quiz' }> => n.kind === 'quiz')
            const mastered = quizzes.filter(q => q.status === 'passed' || q.status === 'retook').length
            return <>
              <span className="kind-chip">Source file</span>
              <h2>{selected.label}</h2>
              <p className="muted">{[selected.source.subjectCode, selected.source.profName].filter(Boolean).join(' · ')}</p>
              <p className="mastery">{quizzes.length ? <><strong>{mastered} of {quizzes.length}</strong> quizzes on this file passed</> : 'No quizzes on this file yet'}</p>
              <h3>Sessions and quizzes that used it</h3>
              <ul className="brain-list">{users.map(n => nodeLink(n.id))}</ul>
            </>
          })()}
        </aside>}
      </section>
    </main>
    <ScribeWidget user={user} mode="student" />
  </div>
}
