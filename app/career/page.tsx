'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Compass, Loader2, Menu } from 'lucide-react'
import { StudentSidebar } from '@/components/student/sidebar'
import { Heatmap, type HeatRow } from '@/components/heatmap/heatmap'
import { ThemeToggle } from '@/components/theme-toggle'
import { ScribeWidget } from '@/components/scribe/assistant-widget'
import { signOut, useSession } from '@/lib/session'
import { archiveOpenChat, deleteChat, listChats, type RecentChat } from '@/lib/recents'
import { listSets, type SavedStudySet } from '@/lib/studysets'
import { evidence, matches, NEED_LABEL, NEXT_STEP, strengths, TOPICS, type Signal, type Use } from '@/lib/career'
import '../student.css'
import './career.css'

const DAY = 24 * 60 * 60 * 1000
const SIGNALS: [Signal, string][] = [['searches', 'Searches'], ['quizzes', 'Quizzes taken'], ['results', 'Quiz results']]
const MIX_KEY: [Signal, string][] = [['searches', 'From searches'], ['quizzes', 'From quizzes taken'], ['results', 'From quiz results']]
const MIX_COLOR: Record<Signal, string> = { searches: 'var(--h2)', quizzes: 'var(--h3)', results: 'var(--h5)' }
const RANKS = ['Best match', '2nd match', '3rd match']
const bin = (v: number) => (v <= 0 ? 0 : Math.min(5, 1 + Math.floor(v / 20.0001)))
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const searchesOf = (n: number) => `${n} ${n === 1 ? 'search' : 'searches'}`
const quizzesOf = (n: number) => `${n} ${n === 1 ? 'quiz' : 'quizzes'}`

export default function CareerPage() {
  const router = useRouter()
  const user = useSession(['Student', 'Professor', 'Admin'])
  const uid = user?.uid
  const [collapsed, setCollapsed] = useState(false)
  const [chats, setChats] = useState<RecentChat[]>([])
  const [sets, setSets] = useState<SavedStudySet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [range, setRange] = useState<'all' | 'recent'>('all')
  const [use, setUse] = useState<Use>({ searches: true, quizzes: true, results: true })

  useEffect(() => {
    if (!uid) return
    Promise.all([listChats(uid), listSets(uid)])
      .then(([c, s]) => { setChats(c); setSets(s) })
      .catch(() => setError('Couldn’t load your study history. Check your connection and reload.'))
      .finally(() => setLoading(false))
  }, [uid])

  const ev = useMemo(() => evidence(chats, sets, range === 'recent' ? new Date(Date.now() - 30 * DAY) : undefined), [chats, sets, range])
  const str = useMemo(() => strengths(ev.topics, use), [ev, use])
  const ms = useMemo(() => matches(str, use).sort((a, b) => b.pct - a.pct), [str, use])

  const logout = async () => { if (uid) await archiveOpenChat(uid).catch(() => {}); await signOut(); router.replace('/login') }
  if (!user) return null

  const empty = !loading && !error && chats.length === 0 && sets.length === 0
  const toggle = (k: Signal, on: boolean) => setUse(u => ({ ...u, [k]: on }))
  const onCount = SIGNALS.filter(([k]) => use[k]).length

  const rows: HeatRow[] = ms.map(m => ({
    id: m.name, label: m.name, sub: m.track,
    cells: m.need.map((n, i) => (n ? str[i].score : 'na')),
    total: `${m.pct}%`, totalValue: m.pct,
  }))
  const top = ms[0]
  const second = ms[1]
  const weakTopic = top ? TOPICS[top.weakest].name : ''
  const shared = top && second ? top.need.filter((n, i) => n && second.need[i]).length : 0
  const scope = range === 'all' ? 'this semester' : 'in the last 30 days'
  const maxS = Math.max(1, ...ev.topics.map(t => t.searches)), maxQ = Math.max(1, ...ev.topics.map(t => t.quizzes))
  const cellStyle = (v: number) => ({ className: `cell${bin(v) >= 4 ? ' ink-strong' : ''}`, style: { background: `var(--h${bin(v)})` } })

  return <div className="app-shell">
    <StudentSidebar user={user} active="career" collapsed={collapsed} setCollapsed={setCollapsed} onLogout={logout}
      recents={chats} onOpenRecent={id => router.push(`/?chat=${id}`)}
      onDeleteRecent={id => { setChats(list => list.filter(c => c.id !== id)); if (uid) deleteChat(uid, id).catch(() => {}) }} />
    <main className="sets-main career-main">
      <header className="mobile-header"><button className="icon-button" aria-label="Open sidebar" onClick={() => setCollapsed(false)}><Menu /></button><span className="brand">SCRIBE</span><ThemeToggle compact /></header>
      <div className="sets-head"><div><h1>Career match</h1>
        <p>Which CICT career paths fit what you’ve been studying. Darker squares mean you’re stronger in a topic that career needs.</p>
        {!loading && !empty && !error && <p className="career-based">Based on {searchesOf(ev.searches)} and {quizzesOf(ev.quizzes)}{ev.avgScore != null ? ` (${ev.avgScore}% average)` : ''} {scope}.</p>}
      </div></div>
      {error && <p className="field-error" role="alert">{error}</p>}

      {loading ? <div className="hm-empty" role="status"><Loader2 className="spin" /><span>Loading your study history…</span></div>
        : empty ? <div className="hm-empty"><Compass /><strong>No career matches yet</strong><span>Ask SCRIBE a few questions and take a quiz, and your career matches will show up here.</span><Link className="outline-button" href="/">Ask SCRIBE</Link></div>
          : !error && <div className="hm-page">
            <div className="career-top3">
              {ms.slice(0, 3).map((m, i) => <article key={m.name} className={`career-match${i === 0 ? ' first' : ''}`}>
                <span className="rank">{RANKS[i]} · {m.track}</span>
                <h3>{m.name}</h3>
                <div className="career-pct"><strong>{m.pct}%</strong><span>match</span></div>
                <div className="career-mix" role="img" aria-label={`Where the match comes from: ${MIX_KEY.map(([k, l]) => `${l.toLowerCase()} ${Math.round(m.mix[k] * 100)}%`).join(', ')}`}>
                  {MIX_KEY.map(([k]) => <i key={k} style={{ width: `${(m.mix[k] * 100).toFixed(1)}%`, background: MIX_COLOR[k] }} />)}
                </div>
                <p className="why">{str[m.best].score === 0 ? 'No activity yet in the topics this career needs.'
                  : <>Strongest in <b>{TOPICS[m.best].name}</b>{str[m.best].avgScore != null ? `: ${searchesOf(str[m.best].searches)}, ${quizzesOf(str[m.best].quizzes)}, ${str[m.best].avgScore}% average` : `: ${searchesOf(str[m.best].searches)}`}.</>}</p>
                <span className="next">Next: {NEXT_STEP[TOPICS[m.weakest].name]} →</span>
              </article>)}
            </div>
            <div className="career-mixkey">{MIX_KEY.map(([k, l]) => <span key={k}><b style={{ background: MIX_COLOR[k] }} />{l}</span>)}</div>

            <div className="hm-filters">
              <div className="seg" role="group" aria-label="Time range">
                <button type="button" aria-pressed={range === 'all'} onClick={() => setRange('all')}>This semester</button>
                <button type="button" aria-pressed={range === 'recent'} onClick={() => setRange('recent')}>Last 30 days</button>
              </div>
              <span className="spacer" />
              <span className="career-count">Count:</span>
              {SIGNALS.map(([k, l]) => <label key={k} className="career-chk"><input type="checkbox" checked={use[k]} disabled={use[k] && onCount === 1} onChange={e => toggle(k, e.target.checked)} /> {l}</label>)}
            </div>

            <section className="hm-card">
              <div className="hm-card-head"><h2>Career paths × topics they need</h2><p>Each square is your strength (0–100) in a topic, shown only where the career needs it. Hover for details.</p></div>
              <Heatmap
                columns={TOPICS.map(t => t.name)}
                rows={rows}
                max={100}
                unit="strength"
                totalLabel="Overall match"
                showValues="dark"
                legendLabel="your strength (0–100)"
                legendNote="– means the career doesn’t rely on that topic"
                describe={(row, col, v) => {
                  const m = ms.find(x => x.name === row.id)!
                  if (v === 'na' || !m.need[col]) return `${row.label} doesn't need ${TOPICS[col].name}`
                  const s = str[col]
                  return `${row.label}, ${TOPICS[col].name}: your strength ${s.score} of 100. ${NEED_LABEL[m.need[col]]} topic for this career. ${searchesOf(s.searches)}, ${quizzesOf(s.quizzes)}${s.avgScore != null ? `, ${s.avgScore}% average` : ', no quiz results yet'}`
                }}
              />
            </section>

            <div className="career-cols">
              <section className="hm-card">
                <div className="hm-card-head"><h2>Your evidence by topic</h2><p>What the scores are built from.</p></div>
                <div className="hm-scroll">
                  <table className="hm career-evidence">
                    <thead><tr><th><span className="sr-only">Topic</span></th><th scope="col">Searches</th><th scope="col">Quizzes taken</th><th scope="col">Average score</th><th scope="col" className="total-head">Strength</th></tr></thead>
                    <tbody>{TOPICS.map((t, i) => { const e = ev.topics[i]; return <tr key={t.name}>
                      <th scope="row" className="row">{t.name}</th>
                      <td {...cellStyle((e.searches / maxS) * 100)}>{e.searches}</td>
                      <td {...cellStyle((e.quizzes / maxQ) * 100)}>{e.quizzes}</td>
                      {e.avgScore == null ? <td className="cell na" aria-label="No quiz results yet">–</td> : <td {...cellStyle(e.avgScore)}>{e.avgScore}%</td>}
                      <td className="total">{str[i].score}</td>
                    </tr> })}</tbody>
                  </table>
                </div>
              </section>
              <section className="hm-card">
                <div className="hm-card-head"><h2>Grow your best match</h2><p>{top.name}</p></div>
                <ul className="career-steps">
                  <li><b>{NEXT_STEP[weakTopic]}.</b> {weakTopic} is the biggest gap for {top.name}.</li>
                  <li><b>Retake quizzes under 75%.</b> Results count for 40% of each topic’s strength.</li>
                  {second && <li><b>Explore {second.name}.</b> It shares {plural(shared, 'topic')} with your best match.</li>}
                </ul>
              </section>
            </div>

            <p className="career-disclaimer">Career match is a study guide based only on your activity in SCRIBE. It isn’t a test of ability. Talk to your adviser or the CICT guidance office before choosing a track.</p>
          </div>}
    </main>
    <ScribeWidget user={user} mode="student" />
  </div>
}
