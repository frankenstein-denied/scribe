// Topic extraction and material-to-material linking. Pure functions: no DOM, no storage.

const STOPWORDS = new Set(`a about above after again against all also am an and any are as at be because been before being below between both but by can
could did do does doing down during each either else etc even ever every few for from further get gets given got had has have having he her here hers
him his how however i if in into is it its itself just least less let like made make makes many may me might more most much must my need new no nor not
now of off often on once one only or other our ours out over own per same shall she should since so some such than that the their theirs them then there
these they this those though through thus to too two under until up upon us use used uses using very via was way we well were what when where whether which
while who whom whose why will with within without would yet you your yours example examples figure fig table page slide chapter section lecture lesson
week module topic topics note notes see also first second third one two three four five six seven eight nine ten eg ie vs pdf pptx docx http https www com
high low means mean sets set measures measure include includes including called based helps help shows show common central given important several various
different following true false yes lot lots things thing kind kinds part parts`
  .split(/\s+/))

export type TermCounts = Record<string, number>

export function words(text: string) {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z][a-z0-9+#-]*[a-z0-9+#]|[a-z]{2,}/g) ?? []
}

// Two-character terms are allowed only as letter+digit ("l1", "k8"), which are common in lecture notation.
export const isContent = (w: string) => (w.length >= 3 || /^[a-z]\d$/.test(w)) &&!STOPWORDS.has(w) && !/^\d/.test(w)

/** Counts content words and repeated two-word phrases, keeping the `limit` most frequent terms. */
export function termCounts(text: string, limit = 80): TermCounts {
  const counts = new Map<string, number>()
  // Phrases never span a sentence or line break ("…negative gradient. Gradient descent…").
  for (const segment of text.split(/[.!?;:\n]+(?:\s|$)|\n/)) {
    const tokens = words(segment)
    for (let i = 0; i < tokens.length; i++) {
      const w = tokens[i]
      if (!isContent(w)) continue
      counts.set(w, (counts.get(w) ?? 0) + 1)
      const next = tokens[i + 1]
      if (next && isContent(next)) counts.set(`${w} ${next}`, (counts.get(`${w} ${next}`) ?? 0) + 1)
    }
  }
  // A phrase only counts once it repeats; single words need no threshold.
  for (const [term, n] of counts) if (term.includes(' ') && n < 2) counts.delete(term)
  // Prefer a phrase over its parts when the phrase explains most of their uses.
  for (const [term, n] of counts) {
    if (!term.includes(' ')) continue
    counts.set(term, n * 1.5)
    for (const part of term.split(' ')) if ((counts.get(part) ?? 0) <= n * 1.2) counts.delete(part)
  }
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]).slice(0, limit))
}

export type Doc = { id: string; terms: TermCounts }

/** TF-IDF weights for every document, computed across the whole collection. */
export function weigh(docs: Doc[]): Map<string, Map<string, number>> {
  const df = new Map<string, number>()
  for (const d of docs) for (const t of Object.keys(d.terms)) df.set(t, (df.get(t) ?? 0) + 1)
  const n = docs.length
  return new Map(docs.map(d => {
    const total = Object.values(d.terms).reduce((a, b) => a + b, 0) || 1
    return [d.id, new Map(Object.entries(d.terms).map(([t, c]) => [t, (c / total) * (Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1)]))]
  }))
}

export function topTerms(weights: Map<string, number>, k: number) {
  return [...weights].sort((a, b) => b[1] - a[1]).slice(0, k).map(([t]) => t)
}

function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0, na = 0, nb = 0
  for (const [t, w] of a) { na += w * w; const v = b.get(t); if (v) dot += w * v }
  for (const w of b.values()) nb += w * w
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export type Link = { a: string; b: string; score: number; shared: string[] }

/** Pairs of documents whose vocabularies overlap enough to call them related. */
export function relate(docs: Doc[], threshold = 0.12): Link[] {
  const w = weigh(docs)
  const links: Link[] = []
  for (let i = 0; i < docs.length; i++) for (let j = i + 1; j < docs.length; j++) {
    const a = w.get(docs[i].id)!, b = w.get(docs[j].id)!
    const score = cosine(a, b)
    if (score < threshold) continue
    const shared = [...a.keys()].filter(t => b.has(t)).sort((x, y) => a.get(y)! * b.get(y)! - a.get(x)! * b.get(x)!).slice(0, 6)
    links.push({ a: docs[i].id, b: docs[j].id, score, shared })
  }
  return links.sort((x, y) => y.score - x.score)
}

/**
 * Terms that are among the `k` most frequent of at least `minDocs` documents: the shared topics shown as tag nodes.
 * Uses raw frequency, not TF-IDF, since IDF would push exactly these shared terms down.
 */
export function sharedTopics(docs: Doc[], k = 15, minDocs = 2): Map<string, string[]> {
  const byTerm = new Map<string, string[]>()
  for (const d of docs) for (const t of Object.keys(d.terms).slice(0, k)) byTerm.set(t, [...(byTerm.get(t) ?? []), d.id])
  return new Map([...byTerm].filter(([, ids]) => ids.length >= minDocs))
}
