'use client'

import { useEffect, useMemo, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { AlertCircle, Flame, Lightbulb, Loader2 } from 'lucide-react'
import { Heatmap, type HeatRow } from '@/components/heatmap/heatmap'
import { listAllMaterials, type InstructorMaterial } from '@/lib/materials'
import { lastWeeks, weekKey } from '@/lib/usage'
import type { VerifiedInstructor } from '@/lib/verified'

const RANGES = [[4, 'Last 4 weeks'], [8, '8 weeks'], [16, 'This semester']] as const

const weekLabel = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
const uploads = (n: number) => `${n} ${n === 1 ? 'upload' : 'uploads'}`
const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`

export function UploadActivity({ instructors, loading = false, loadError = '' }: { instructors: VerifiedInstructor[]; loading?: boolean; loadError?: string }) {
  const [materials, setMaterials] = useState<InstructorMaterial[] | null>(null)
  const [error, setError] = useState<'' | 'denied' | 'failed'>('')
  const [range, setRange] = useState(8)

  useEffect(() => {
    let live = true
    listAllMaterials().then(r => { if (live) setMaterials(r) }).catch(e => { if (live) setError(e instanceof FirebaseError && e.code === 'permission-denied' ? 'denied' : 'failed') })
    return () => { live = false }
  }, [])

  const weeks = useMemo(() => lastWeeks(range), [range])

  // owner email (lowercase) -> uploads per week key
  const perOwner = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const m of materials ?? []) {
      const email = (m.ownerEmail ?? '').toLowerCase()
      const wk = weekKey(new Date(m.createdAt))
      const byWeek = map.get(email) ?? new Map<string, number>()
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + 1)
      map.set(email, byWeek)
    }
    return map
  }, [materials])

  const rows: HeatRow[] = useMemo(() => instructors.map(v => {
    const byWeek = perOwner.get(v.email.toLowerCase())
    const cells = weeks.map(w => byWeek?.get(w) ?? 0)
    const totalValue = cells.reduce<number>((a, c) => a + c, 0)
    return { id: v.email, label: v.name, sub: v.email, cells, total: totalValue, totalValue }
  }).sort((a, b) => (b.totalValue ?? 0) - (a.totalValue ?? 0) || a.label.localeCompare(b.label)), [instructors, perOwner, weeks])

  if (error) return <div className="hm-empty error" role="alert"><AlertCircle /><strong>{error === 'denied' ? 'You don’t have access to upload data. Ask your CICT admin to check your admin access.' : 'Couldn’t load uploads. Check your connection and reload the page.'}</strong></div>
  if (loadError) return <div className="hm-empty error" role="alert"><AlertCircle /><strong>{loadError}</strong></div>
  if (!materials || loading) return <div className="hm-empty" role="status"><Loader2 className="spin" /><span>Loading uploads…</span></div>
  if (instructors.length === 0) return <div className="hm-empty"><Flame /><strong>No verified instructors yet.</strong><span>Add instructors on the Verified instructors page and their uploads will appear here.</span></div>

  const top = rows[0]
  const sum = rows.reduce((a, r) => a + (r.totalValue ?? 0), 0)
  const none = rows.filter(r => r.totalValue === 0).length
  const quiet = rows[rows.length - 1]
  const scope = range < 16 ? 'in this range' : 'this semester'

  return <div className="hm-page">
    <div className="hm-tiles">
      <div className="hm-tile"><strong className="hm-txt">{top && top.totalValue ? top.label : 'None yet'}</strong><span>Most uploads{top && top.totalValue ? ` · ${files(top.totalValue)}` : ''}</span></div>
      <div className="hm-tile"><strong>{sum}</strong><span>Files uploaded in range</span></div>
      <div className="hm-tile"><strong>{instructors.length}</strong><span>Verified instructors</span></div>
      <div className="hm-tile"><strong>{none}</strong><span>Instructors with no uploads</span></div>
    </div>

    <div className="hm-filters">
      <div className="hm-seg" role="group" aria-label="Time range">
        {RANGES.map(([v, l]) => <button key={v} type="button" aria-pressed={range === v} onClick={() => setRange(v)}>{l}</button>)}
      </div>
    </div>

    <section className="hm-card">
      <div className="hm-card-head"><h2>Uploads per instructor, by week</h2><p>Sorted by total uploads. Hover a square for the count.</p></div>
      <Heatmap
        columns={weeks.map(weekLabel)}
        rows={rows}
        unit="uploads"
        totalLabel="Total uploads"
        describe={(row, col, v) => `${row.label}, week of ${weekLabel(weeks[col])}: ${uploads(typeof v === 'number' ? v : 0)}`}
      />
    </section>

    {none > 0 && quiet && <div className="hm-insight"><Lightbulb aria-hidden="true" /><span><b>{quiet.label}</b> hasn’t uploaded any files {scope}, so students can’t get answers from their materials yet.</span></div>}
  </div>
}
