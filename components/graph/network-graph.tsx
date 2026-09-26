'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d'
import { useIsDark } from '@/lib/theme'

// An Obsidian-style force graph: small dots, labels that appear as you zoom, hover to light up neighbors.
// Callers decide what nodes mean; this only draws them. Used by the instructor knowledge graph and the student 2nd brain.

export type NetNode = {
  id: string
  label: string
  color: string
  radius: number
  /** Hubs (subjects, sources) always show their label in bold. */
  hub?: boolean
  /** Minor nodes (topics) are drawn with muted labels. */
  minor?: boolean
  labelPrefix?: string
  /** Extra outline, e.g. to mark the current session. */
  ring?: string
}
export type NetLink = { source: string; target: string; width: number; distance: number; strong?: boolean; dashed?: boolean }

type Node = NodeObject<NetNode>
type Link = LinkObject<NetNode, NetLink>

// Typed as string ids, but the simulation swaps them for node objects at runtime.
const endId = (end: unknown) => (typeof end === 'object' && end ? String((end as Node).id) : String(end))
const MAX_FIT_ZOOM = 2.2

const PALETTE = {
  light: { ink: '#211B1C', muted: '#6F6668', ring: '#211B1C', hubStroke: '#FFFFFF', strong: 'rgba(122,26,42,0.45)', strongLit: '#7A1A2A', weak: 'rgba(160,150,152,0.35)', weakLit: '#9E6B74', faded: 'rgba(160,150,152,0.12)' },
  dark: { ink: '#F1EAEA', muted: '#B5AAAC', ring: '#F1EAEA', hubStroke: '#1C1617', strong: 'rgba(239,163,176,0.45)', strongLit: '#EFA3B0', weak: 'rgba(181,170,172,0.28)', weakLit: '#C9A0A8', faded: 'rgba(181,170,172,0.10)' },
}

export default function NetworkGraph({ nodes, links, selectedId, query, onSelect, fitSignal, charge = -90 }: {
  nodes: NetNode[]; links: NetLink[]; selectedId: string | null; query: string; onSelect: (id: string | null) => void; fitSignal: number; charge?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const fg = useRef<ForceGraphMethods<Node, Link>>(undefined)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const fitted = useRef(false)
  const colors = PALETTE[useIsDark() ? 'dark' : 'light']

  // The graph library mutates link endpoints into node objects, so hand it fresh copies.
  const data = useMemo(() => ({ nodes: nodes.map(n => ({ ...n })), links: links.map(l => ({ ...l })) }), [nodes, links])
  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const l of links) {
      map.set(l.source, (map.get(l.source) ?? new Set()).add(l.target))
      map.set(l.target, (map.get(l.target) ?? new Set()).add(l.source))
    }
    return map
  }, [links])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const mounted = size.width > 0
  useEffect(() => {
    const g = fg.current
    if (!g) return
    fitted.current = false
    g.d3Force('charge')?.strength(charge)
    const link = g.d3Force('link') as unknown as { distance: (fn: (l: Link) => number) => void } | undefined
    link?.distance(l => l.distance)
    g.d3ReheatSimulation()
  }, [data, mounted, charge])

  // Fit everything in view, but don't blow a handful of nodes up to giant circles.
  const fit = (ms = 400) => {
    const g = fg.current
    if (!g) return
    g.zoomToFit(ms, 60)
    window.setTimeout(() => { if (g.zoom() > MAX_FIT_ZOOM) g.zoom(MAX_FIT_ZOOM, 250) }, ms + 20)
  }

  // Bring the selected node into view, nudged left so the details panel doesn't cover it.
  const centerOnSelected = () => {
    const g = fg.current, n = data.nodes.find(n => n.id === selectedId) as Node | undefined
    if (!g || n?.x == null) return
    g.centerAt(n.x + (size.width > 700 ? 170 : 0) / g.zoom(), n.y! + (size.width > 700 ? 0 : 120 / g.zoom()), 500)
  }

  useEffect(() => { if (fitSignal) fit() }, [fitSignal])
  useEffect(() => { if (selectedId) centerOnSelected() }, [selectedId])

  const focus = hoverId ?? selectedId
  const q = query.trim().toLowerCase()
  const isLit = (id: string, label: string) => {
    if (q) return label.toLowerCase().includes(q)
    return !focus || id === focus || !!neighbors.get(focus)?.has(id)
  }

  return <div ref={box} className="graph-canvas">
    {size.width > 0 && <ForceGraph2D<NetNode, NetLink>
      ref={fg}
      width={size.width}
      height={size.height}
      graphData={data}
      backgroundColor="rgba(0,0,0,0)"
      cooldownTicks={200}
      onEngineStop={() => {
        if (fitted.current) return
        fitted.current = true
        fit()
        if (selectedId) window.setTimeout(centerOnSelected, 700)
      }}
      nodeLabel={() => ''}
      onNodeHover={n => setHoverId(n ? String(n.id) : null)}
      onNodeClick={n => onSelect(String(n.id))}
      onBackgroundClick={() => onSelect(null)}
      nodeCanvasObject={(n, ctx, scale) => {
        const r = n.radius, lit = isLit(String(n.id), n.label)
        ctx.globalAlpha = lit ? 1 : 0.15
        ctx.beginPath(); ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI)
        ctx.fillStyle = n.color; ctx.fill()
        if (n.hub) { ctx.lineWidth = 2 / scale; ctx.strokeStyle = colors.hubStroke; ctx.stroke() }
        if (n.ring) { ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 2.5 / scale, 0, 2 * Math.PI); ctx.lineWidth = 1.5 / scale; ctx.strokeStyle = n.ring; ctx.setLineDash([3 / scale, 2 / scale]); ctx.stroke(); ctx.setLineDash([]) }
        if (n.id === selectedId) { ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 3 / scale + 1, 0, 2 * Math.PI); ctx.lineWidth = 2 / scale; ctx.strokeStyle = colors.ring; ctx.stroke() }
        // Like Obsidian: labels appear as you zoom in, or for whatever is in focus.
        const showLabel = n.hub || scale > 1.6 || (lit && (focus || q)) || (!n.minor && scale > 0.9)
        if (showLabel) {
          const px = Math.max(11 / scale, 2.5)
          ctx.font = `${n.hub ? 'bold ' : ''}${px}px Arial, sans-serif`
          ctx.textAlign = 'center'; ctx.textBaseline = 'top'
          ctx.fillStyle = n.minor ? colors.muted : colors.ink
          const text = n.label.length > 40 ? n.label.slice(0, 38) + '…' : n.label
          ctx.fillText((n.labelPrefix ?? '') + text, n.x!, n.y! + r + 2 / scale)
        }
        ctx.globalAlpha = 1
      }}
      nodePointerAreaPaint={(n, paint, ctx) => { ctx.fillStyle = paint; ctx.beginPath(); ctx.arc(n.x!, n.y!, n.radius + 3, 0, 2 * Math.PI); ctx.fill() }}
      linkColor={l => {
        const touched = focus && (endId(l.source) === focus || endId(l.target) === focus)
        if (touched) return l.strong ? colors.strongLit : colors.weakLit
        if (focus || q) return colors.faded
        return l.strong ? colors.strong : colors.weak
      }}
      linkWidth={l => l.width}
      linkLineDash={l => (l.dashed ? [2, 2] : null)}
    />}
  </div>
}
