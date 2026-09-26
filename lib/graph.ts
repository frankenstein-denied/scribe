import type { Format } from '@/lib/extract'
import type { InstructorMaterial } from '@/lib/materials'
import { relate, sharedTopics, type Link } from '@/lib/topics'
import type { Subject } from '@/types'
import type { NetLink, NetNode } from '@/components/graph/network-graph'

export type NodeKind = 'file' | 'subject' | 'topic'
export type GraphNode = { id: string; kind: NodeKind; label: string; format?: Format; degree: number }
export type GraphLink = { source: string; target: string; kind: 'subject' | 'topic' | 'similar'; score?: number; shared?: string[] }

export const NODE_COLORS: Record<Format | 'subject' | 'topic', string> = {
  pdf: '#9E2F40', pptx: '#C0662B', docx: '#2F5F9E', subject: '#4A0E17', topic: '#A59A9C',
}

export const subjectNodeId = (id: string) => `subject:${id}`
export const topicNodeId = (term: string) => `topic:${term}`

export type GraphOptions = { showSubjects: boolean; showTopics: boolean }

export type Analysis = { links: Link[]; topics: Map<string, string[]> }

/** The expensive part (pairwise similarity), kept separate so toggling views doesn't recompute it. */
export function analyze(materials: InstructorMaterial[]): Analysis {
  const docs = materials.filter(m => m.status === 'ready').map(m => ({ id: m.id, terms: m.terms }))
  return { links: relate(docs), topics: sharedTopics(docs) }
}

export function buildGraph(materials: InstructorMaterial[], subjects: Subject[], analysis: Analysis, opts: GraphOptions) {
  const ready = materials.filter(m => m.status === 'ready')
  const nodes: GraphNode[] = ready.map(m => ({ id: m.id, kind: 'file', label: m.title, format: m.format, degree: 0 }))
  const links: GraphLink[] = analysis.links.map(l => ({ source: l.a, target: l.b, kind: 'similar', score: l.score, shared: l.shared }))

  if (opts.showSubjects) for (const s of subjects) {
    const members = ready.filter(m => m.subjectId === s.id)
    if (!members.length) continue
    nodes.push({ id: subjectNodeId(s.id), kind: 'subject', label: `${s.code} · ${s.title}`, degree: 0 })
    for (const m of members) links.push({ source: m.id, target: subjectNodeId(s.id), kind: 'subject' })
  }

  if (opts.showTopics) for (const [term, ids] of analysis.topics) {
    nodes.push({ id: topicNodeId(term), kind: 'topic', label: term, degree: 0 })
    for (const id of ids) links.push({ source: id, target: topicNodeId(term), kind: 'topic' })
  }

  const byId = new Map(nodes.map(n => [n.id, n]))
  for (const l of links) { byId.get(l.source)!.degree++; byId.get(l.target)!.degree++ }
  return { nodes, links }
}

/** How the instructor graph looks: files sized by connections, subjects as hubs, topics as small #tags. */
export function toNetwork(graph: { nodes: GraphNode[]; links: GraphLink[] }): { nodes: NetNode[]; links: NetLink[] } {
  return {
    nodes: graph.nodes.map(n => ({
      id: n.id, label: n.label,
      color: n.kind === 'file' ? NODE_COLORS[n.format!] : NODE_COLORS[n.kind],
      radius: n.kind === 'subject' ? 9 : n.kind === 'topic' ? 2.5 + Math.min(n.degree, 6) * 0.4 : 4.5 + Math.sqrt(n.degree) * 1.4,
      hub: n.kind === 'subject', minor: n.kind === 'topic', labelPrefix: n.kind === 'topic' ? '#' : undefined,
    })),
    links: graph.links.map(l => ({
      source: l.source, target: l.target, strong: l.kind === 'similar', dashed: l.kind === 'topic',
      width: l.kind === 'similar' ? 1 + (l.score ?? 0) * 4 : 0.6,
      distance: l.kind === 'similar' ? 70 - (l.score ?? 0) * 40 : l.kind === 'subject' ? 55 : 35,
    })),
  }
}
