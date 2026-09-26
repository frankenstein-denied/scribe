// Splits extracted text into passage-sized chunks that remember their page. These are what students' answers cite.

export type Chunk = { page?: number; text: string }

const TARGET = 650
const MAX = 1000

/** Lines as the author meant them: PDF lines that were only wrapped by layout are joined back up. */
export function logicalLines(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    const prev = out[out.length - 1]
    if (prev && !/[.!?:;]$/.test(prev) && /^[a-z(,]/.test(line)) out[out.length - 1] = `${prev} ${line}`
    else out.push(line)
  }
  return out
}

export const splitSentences = (line: string) => line.split(/(?<=[.!?])\s+(?=["“(\[]?[A-Z0-9])/).filter(Boolean)

/** Packs whole sentences into chunks of about TARGET characters, keeping line breaks and never crossing pages. */
export function chunkPages(pageTexts: string[], paged: boolean): Chunk[] {
  const chunks: Chunk[] = []
  pageTexts.forEach((pageText, i) => {
    const page = paged ? i + 1 : undefined
    let current = ''
    const flush = () => { if (current.trim().length >= 20) chunks.push({ page, text: current.trim() }); current = '' }
    for (const line of logicalLines(pageText)) {
      splitSentences(line).forEach((sentence, j) => {
        // A run-on "sentence" (common in slide exports) gets hard-wrapped at word boundaries.
        const pieces = sentence.length > MAX ? sentence.match(new RegExp(`.{1,${TARGET}}(\\s|$)`, 'g')) ?? [sentence] : [sentence]
        pieces.forEach((piece, k) => {
          if (current && current.length + piece.length > TARGET) flush()
          current += (current ? (j === 0 && k === 0 ? '\n' : ' ') : '') + piece.trim()
        })
      })
    }
    // A short leftover joins the previous chunk from the same page instead of becoming its own weak passage.
    const last = chunks[chunks.length - 1]
    if (current.trim() && current.trim().length < 160 && last && last.page === page && last.text.length + current.length < MAX) {
      last.text += '\n' + current.trim()
      current = ''
    }
    flush()
  })
  return chunks
}
