import JSZip from 'jszip'

export type Format = 'pdf' | 'pptx' | 'docx'

export const ACCEPT = '.pdf,.pptx,.docx'
export const MAX_BYTES = 50 * 1024 * 1024

export function formatOf(fileName: string): Format | null {
  const ext = fileName.toLowerCase().split('.').pop()
  return ext === 'pdf' || ext === 'pptx' || ext === 'docx' ? ext : null
}

/** Reason a file can't be uploaded, or null if it's fine. */
export function rejectReason(file: { name: string; size: number }): string | null {
  const ext = file.name.toLowerCase().split('.').pop()
  if (ext === 'ppt' || ext === 'doc') return `Old .${ext} format isn't supported. Save it as .${ext}x and upload again.`
  if (!formatOf(file.name)) return 'Only PDF, PPTX, and DOCX files are supported.'
  if (file.size > MAX_BYTES) return 'File is larger than 50 MB.'
  if (file.size === 0) return 'File is empty.'
  return null
}

const decodeXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&')

/** Joins the text runs (<w:t> / <a:t>) of an Office XML part, one line per paragraph. */
export function officeXmlText(xml: string, runTag: 'w:t' | 'a:t', paraTag: 'w:p' | 'a:p'): string {
  const run = new RegExp(`<${runTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${runTag}>`, 'g')
  return xml.split(`</${paraTag}>`)
    .map(para => Array.from(para.matchAll(run), m => decodeXml(m[1])).join(''))
    .filter(line => line.trim())
    .join('\n')
}

async function extractDocx(data: ArrayBuffer) {
  const zip = await JSZip.loadAsync(data)
  const doc = await zip.file('word/document.xml')?.async('string')
  if (!doc) throw new Error('This DOCX file looks damaged.')
  const app = await zip.file('docProps/app.xml')?.async('string')
  const pages = Number(app?.match(/<Pages>(\d+)<\/Pages>/)?.[1]) || undefined
  // Word files don't store page breaks reliably, so the whole document is one untitled "page".
  const text = officeXmlText(doc, 'w:t', 'w:p')
  return { text, pages, pageTexts: [text], paged: false }
}

async function extractPptx(data: ArrayBuffer) {
  const zip = await JSZip.loadAsync(data)
  const slides = Object.keys(zip.files)
    .map(name => ({ name, n: Number(name.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1]) }))
    .filter(s => s.n)
    .sort((a, b) => a.n - b.n)
  if (!slides.length) throw new Error('No slides found in this PPTX file.')
  const texts = await Promise.all(slides.map(async s => officeXmlText(await zip.file(s.name)!.async('string'), 'a:t', 'a:p')))
  return { text: texts.join('\n\n'), pages: slides.length, pageTexts: texts, paged: true }
}

async function extractPdf(data: ArrayBuffer) {
  // The legacy build runs on browsers older than the last year or so; the default one needs very new JS APIs.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc ||= new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
  const task = pdfjs.getDocument({ data: new Uint8Array(data) })
  try {
    const doc = await task.promise
    const pages: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent()
      pages.push(content.items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join(''))
    }
    return { text: pages.join('\n\n'), pages: doc.numPages, pageTexts: pages, paged: true }
  } finally {
    await task.destroy()
  }
}

/** `pageTexts[i]` is page (or slide) i + 1 when `paged` is true. */
export type Extracted = { text: string; pages?: number; pageTexts: string[]; paged: boolean }

export async function extractText(file: File): Promise<Extracted> {
  const data = await file.arrayBuffer()
  const format = formatOf(file.name)
  const result = format === 'pdf' ? await extractPdf(data) : format === 'pptx' ? await extractPptx(data) : await extractDocx(data)
  if (!result.text.trim()) throw new Error(format === 'pdf' ? 'No text found. This PDF may be scanned.' : 'No text found in this file.')
  return result
}
