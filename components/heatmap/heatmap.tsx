'use client'

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export type HeatCell = number | null | 'na' // null = no data yet; 'na' = not applicable
export type HeatRow = { id: string; label: string; sub?: string; cells: HeatCell[]; total?: ReactNode; totalValue?: number }

const binOf = (v: HeatCell, max: number) => (typeof v !== 'number' || v <= 0 ? 0 : Math.min(5, 1 + Math.floor((v / max) * 4.999)))
const thresholds = (max: number) => [1, 2, 3, 4, 5].map(b => Math.max(1, Math.ceil(((b - 1) / 4.999) * max)))

type Tip = { title: string; text: string; x: number; y: number }

export function Heatmap({ columns, rows, max, unit, totalLabel, showValues = 'none', describe, legendLabel, legendNote }: {
  columns: string[]
  rows: HeatRow[]
  max?: number
  unit: string
  totalLabel?: string
  showValues?: 'none' | 'dark' | 'all'
  describe: (row: HeatRow, col: number, value: HeatCell) => string
  legendLabel?: string
  legendNote?: string
}) {
  const [table, setTable] = useState(false)
  const [tip, setTip] = useState<Tip | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  const scale = max ?? Math.max(5, ...rows.flatMap(r => r.cells.filter((c): c is number => typeof c === 'number')))
  const maxTotal = Math.max(1, ...rows.map(r => r.totalValue ?? 0))
  const t = thresholds(scale)
  const legendSteps = t.filter((x, i) => t.indexOf(x) === i)

  // Roving tabindex: one cell is the tab stop; arrow keys move between cells.
  const [active, setActive] = useState('0:0')
  const wrapRef = useRef<HTMLDivElement>(null)
  const move = (e: KeyboardEvent<HTMLTableCellElement>, r: number, c: number) => {
    const cols = rows[r]?.cells.length ?? 0
    let nr = r, nc = c
    if (e.key === 'ArrowRight') nc = Math.min(cols - 1, c + 1)
    else if (e.key === 'ArrowLeft') nc = Math.max(0, c - 1)
    else if (e.key === 'ArrowDown') nr = Math.min(rows.length - 1, r + 1)
    else if (e.key === 'ArrowUp') nr = Math.max(0, r - 1)
    else if (e.key === 'Home') nc = 0
    else if (e.key === 'End') nc = cols - 1
    else return
    e.preventDefault()
    setActive(`${nr}:${nc}`)
    wrapRef.current?.querySelector<HTMLElement>(`[data-cell="${nr}:${nc}"]`)?.focus()
  }
  const activeKey = rows.length === 0 ? '' : (() => { const [ar, ac] = active.split(':').map(Number); return ar < rows.length && ac < (rows[ar]?.cells.length ?? 0) ? active : '0:0' })()

  // Keep the tooltip inside the viewport; it is measured after render so its real size is used.
  useLayoutEffect(() => {
    const el = tipRef.current
    if (!tip || !el) return
    const { width, height } = el.getBoundingClientRect()
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, tip.x + 12))}px`
    el.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, tip.y - height - 10))}px`
  }, [tip])

  const show = (row: HeatRow, col: number, v: HeatCell, x: number, y: number) => setTip({ title: row.label, text: describe(row, col, v), x, y })
  const text = (v: HeatCell) => (v === 'na' ? '–' : v == null ? '–' : String(v))

  return <div className="hm-wrap" ref={wrapRef}>
    <div className="hm-scroll">
      <table className="hm">
        <thead><tr>
          <th><span className="sr-only">Name</span></th>
          {columns.map((c, i) => <th key={i} scope="col">{c}</th>)}
          {totalLabel && <th scope="col" className="total-head">{totalLabel}</th>}
        </tr></thead>
        <tbody>
          {rows.map((row, ri) => <tr key={row.id}>
            <th scope="row" className="row" title={row.label}>{row.label}{row.sub && <small>{row.sub}</small>}</th>
            {row.cells.map((v, col) => {
              const bin = binOf(v, scale)
              const na = v === 'na'
              const printed = typeof v === 'number' && (showValues === 'all' || (showValues === 'dark' && bin >= 4))
              return <td
                key={col}
                className={`cell${na ? ' na' : ''}${bin >= 4 && showValues !== 'none' ? ' ink-strong' : ''}`}
                data-cell={`${ri}:${col}`}
                tabIndex={activeKey === `${ri}:${col}` ? 0 : -1}
                onKeyDown={e => move(e, ri, col)}
                aria-label={describe(row, col, v)}
                style={na ? undefined : { background: `var(--h${bin})` }}
                onMouseMove={e => show(row, col, v, e.clientX, e.clientY)}
                onMouseLeave={() => setTip(null)}
                onFocus={e => { setActive(`${ri}:${col}`); const r = e.currentTarget.getBoundingClientRect(); show(row, col, v, r.right, r.top) }}
                onBlur={() => setTip(null)}
              >{na ? '–' : printed ? v : null}</td>
            })}
            {totalLabel && <td className="total">
              <span className="hm-bar" style={{ width: Math.round(56 * (row.totalValue ?? 0) / maxTotal) }} aria-hidden="true" />{row.total ?? row.totalValue ?? 0}
            </td>}
          </tr>)}
        </tbody>
      </table>
    </div>

    <div className="hm-foot">
      <div className="hm-legend" role="group" aria-label="Colour scale">
        <span>Fewer</span>
        {[0, 1, 2, 3, 4, 5].map(b => <i key={b} style={{ background: `var(--h${b})` }} title={b === 0 ? '0' : `${t[b - 1]}+`} />)}
        <span>More</span>
        <span className="legend-note">0 · {legendSteps.map(x => `${x}+`).join(' · ')} {legendLabel ?? `${unit} per week`}</span>
        {legendNote && <span className="legend-note">{legendNote}</span>}
      </div>
      <button type="button" className="text-button" aria-expanded={table} onClick={() => setTable(v => !v)}>{table ? 'Hide table' : 'Show as table'}</button>
    </div>

    {table && <div className="hm-scroll">
      <table className="hm-plain">
        <thead><tr><th scope="col">Name</th>{columns.map((c, i) => <th key={i} scope="col">{c}</th>)}{totalLabel && <th scope="col">{totalLabel}</th>}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>
          <th scope="row">{row.label}</th>
          {row.cells.map((v, i) => <td key={i}>{text(v)}</td>)}
          {totalLabel && <td>{row.total ?? row.totalValue ?? 0}</td>}
        </tr>)}</tbody>
      </table>
    </div>}

    {tip && <div className="hm-tip" ref={tipRef} role="presentation"><b>{tip.title}</b>{tip.text}</div>}
  </div>
}
