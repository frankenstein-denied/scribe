'use client'

import { useEffect, useMemo, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { AlertCircle, Flame, Lightbulb, Loader2 } from 'lucide-react'
import { Heatmap, type HeatRow } from '@/components/heatmap/heatmap'
import type { InstructorMaterial } from '@/lib/materials'
import { lastWeeks, listUsageFor, weekKey, type UsageRow } from '@/lib/usage'
import { subjects } from '@/types'

type Kind = 'all' | 'answers' | 'quizzes' | 'assistant'
const RANGES = [[4, 'Last 4 weeks'], [8, '8 weeks'], [16, 'This semester']] as const
const KINDS: [Kind, string][] = [['all', 'All uses'], ['answers', 'Ask SCRIBE answers'], ['quizzes', 'Quizzes made'], ['assistant', 'Assistant replies']]

const weekLabel = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
const uses = (n: number) => `${n} ${n === 1 ? 'use' : 'uses'}`

export function UsageView({ materials, ownerEmail }: { materials: InstructorMaterial[]; ownerEmail: string }) {
  const [usage, setUsage] = useState<UsageRow[] | null>(null)
  const [error, setError] = useState<'' | 'denied' | 'failed'>('')
  const [range, setRange] = useState(8)
  const [kind, setKind] = useState<Kind>('all')
  const [subject, setSubject] = useState('')

  useEffect(() => {
    let live = true
    listUsageFor(ownerEmail.toLowerCase()).then(r => { if (live) setUsage(r) }).catch(e => { if (live) setError(e instanceof FirebaseError && e.code === 'permission-denied' ? 'denied' : 'failed') })
    return () => { live = false }
  }, [ownerEmail])

  const ready = useMemo(() => materials.filter(m => m.status === 'ready'), [materials])
  const subjectOptions = useMemo(() => subjects.filter(s => ready.some(m => m.subjectId === s.id)), [ready])
  const weeks = useMemo(() => lastWeeks(range), [range])

  const byKey = useMemo(() => {
    const map = new Map<string, UsageRow>()
    for (const u of usage ?? []) map.set(`${u.materialId}_${u.week}`, u)
    return map
  }, [usage])

  const rows: HeatRow[] = useMemo(() => {
    const pick = (u: UsageRow | undefined) => (!u ? 0 : kind === 'all' ? u.answers + u.quizzes + u.assistant : u[kind])
    return ready.filter(m => !subject || m.subjectId === subject).map(m => {
      const since = weekKey(new Date(m.createdAt))
      const cells = weeks.map(w => (w < since ? 'na' as const : pick(byKey.get(`${m.id}_${w}`))))
      const totalValue = cells.reduce<number>((a, v) => a + (typeof v === 'number' ? v : 0), 0)
      return { id: m.id, label: m.title, sub: m.fileName, cells, total: totalValue, totalValue }
    }).sort((a, b) => (b.totalValue ?? 0) - (a.totalValue ?? 0) || a.label.localeCompare(b.label))
  }, [ready, subject, weeks, byKey, kind])

  if (error) return <div className="hm-empty error" role="alert"><AlertCircle /><strong>{error === 'denied' ? 'Usage tracking isn’t switched on yet. Ask your CICT admin to finish setup.' : 'Couldn’t load usage. Check your connection and reload the page.'}</strong></div>
  if (!usage) return <div className="hm-empty" role="status"><Loader2 className="spin" /><span>Loading usage…</span></div>
  if (ready.length === 0 || usage.length === 0) return <div className="hm-empty"><Flame /><strong>No usage yet</strong><span>Counts appear here as students ask SCRIBE questions, make quizzes and chat with the assistant.</span></div>

  const top = rows[0]
  const sum = rows.reduce((a, r) => a + (r.totalValue ?? 0), 0)
  const unused = rows.filter(r => r.totalValue === 0).length
  const thisWeek = weekKey(new Date())
  const low = [...rows].reverse().find(r => { const m = ready.find(x => x.id === r.id); return m && weekKey(new Date(m.createdAt)) < thisWeek })

  return <div className="hm-page">
    <div className="hm-tiles">
      <div className="hm-tile"><strong className="hm-txt">{top && top.totalValue ? top.label : 'None yet'}</strong><span>Most used file{top && top.totalValue ? ` · ${uses(top.totalValue)}` : ''}</span></div>
      <div className="hm-tile"><strong>{sum}</strong><span>Total uses in range</span></div>
      <div className="hm-tile"><strong>{ready.length}</strong><span>Files tracked</span></div>
      <div className="hm-tile"><strong>{unused}</strong><span>Files not used in range</span></div>
    </div>

    <div className="hm-filters">
      <div className="hm-seg" role="group" aria-label="Time range">
        {RANGES.map(([v, l]) => <button key={v} type="button" aria-pressed={range === v} onClick={() => setRange(v)}>{l}</button>)}
      </div>
      <select aria-label="Kind of use" value={kind} onChange={e => setKind(e.target.value as Kind)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <span className="spacer" />
      <select aria-label="Subject" value={subject} onChange={e => setSubject(e.target.value)}>
        <option value="">All subjects</option>
        {subjectOptions.map(s => <option key={s.id} value={s.id}>{s.code} · {s.title}</option>)}
      </select>
    </div>

    <section className="hm-card">
      <div className="hm-card-head"><h2>Uses per file, by week</h2><p>Sorted by total uses. Hover a square for the count.</p></div>
      {rows.length === 0
        ? <p className="hm-muted">No ready files in this subject.</p>
        : <Heatmap
          columns={weeks.map(weekLabel)}
          rows={rows}
          unit="uses"
          totalLabel="Total uses"
          describe={(row, col, v) => `${row.label}, week of ${weekLabel(weeks[col])}: ${v == null || v === 'na' ? 'not uploaded yet' : uses(v)}`}
        />}
    </section>

    {low && low.totalValue === 0 && <div className="hm-insight"><Lightbulb aria-hidden="true" /><span><b>{low.label}</b> is rarely used. Students may not be asking about it, or it may need clearer text for SCRIBE to find.</span></div>}
  </div>
}
