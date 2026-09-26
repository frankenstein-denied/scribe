'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Send, X } from 'lucide-react'
import { ScribeAvatar, SCRIBE_GREETING } from '@/components/scribe/avatar'
import { respond } from '@/lib/assistant'
import { loadLibrary, type Library } from '@/lib/library'
import { buildIndex } from '@/lib/retrieval'
import { termCounts } from '@/lib/topics'
import type { AppUser } from '@/lib/session'

// SCRIBE as a companion that stays with you on every dashboard: a floating avatar that greets you and opens a chat.
// It uses the same language engine as Ask SCRIBE and shows short answers, with a link to the full notebook answer.

type MiniCell = { heading?: string; excerpt: string; source: string }
type Msg = { id: string; from: 'user' | 'scribe'; text: string; cells?: MiniCell[]; more?: number; ask?: string; quiz?: boolean }

const MAX_CELLS = 4
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

export function ScribeWidget({ user, mode }: { user: AppUser; mode: 'student' | 'instructor' }) {
  const key = (k: string) => `scribe-widget-${k}:${user.uid}`
  const [open, setOpen] = useState(false)
  const [teaser, setTeaser] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [library, setLibrary] = useState<Library | null>(null)
  const [loading, setLoading] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  // The conversation and open/closed state follow the user across dashboards for this browser session.
  useEffect(() => {
    try {
      setMessages(JSON.parse(sessionStorage.getItem(key('msgs')) ?? '[]'))
      setOpen(sessionStorage.getItem(key('open')) === '1')
      if (!sessionStorage.getItem(key('greeted'))) {
        sessionStorage.setItem(key('greeted'), '1')
        setTeaser(true)
        const t = window.setTimeout(() => setTeaser(false), 7000)
        return () => window.clearTimeout(t)
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid])
  useEffect(() => { try { sessionStorage.setItem(key('msgs'), JSON.stringify(messages.slice(-30))) } catch {} }, [messages]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { sessionStorage.setItem(key('open'), open ? '1' : '0') } catch {} }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Course materials load the first time the panel opens.
  useEffect(() => {
    if (!open || library || loading) return
    setLoading(true)
    loadLibrary().then(setLibrary).catch(() => setMessages(m => [...m, { id: `e${Date.now()}`, from: 'scribe', text: 'I couldn’t reach the course materials. Check your connection and try again.' }])).finally(() => setLoading(false))
  }, [open, library, loading])
  useEffect(() => { requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })) }, [messages, open])

  const index = useMemo(() => (library ? buildIndex(library.passages) : null), [library])

  const chips = useMemo(() => {
    if (!library?.materials.length) return []
    if (mode === 'instructor') {
      const mine = library.materials.filter(m => m.ownerName === user.name).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return mine.length ? ['Give me everything I uploaded', 'What topics do my files cover?', `Make a reviewer from the ${mine[0].title} file`] : ['What topics are covered across all files?']
    }
    const topics = Object.keys(termCounts(library.passages.map(p => p.text).join('\n'), 30)).filter(t => t.includes(' '))
    return [`Make a reviewer on ${topics[0] ?? 'the latest lecture'}`, `Quiz me on ${topics[1] ?? topics[0] ?? 'the latest lecture'}`, 'What topics are covered?']
  }, [library, mode, user.name])

  const ask = (q: string) => {
    const question = q.trim()
    if (!question || !library || !index) return
    const reply = respond(question, library, index, null, mode === 'instructor' ? user.name : undefined)
    const all = reply.parts.flatMap(p => p.cells)
    const cells = all.slice(0, MAX_CELLS).map(c => ({
      heading: c.heading,
      excerpt: clip(c.excerpt.replace(/\n/g, ' · '), 220),
      source: [c.passage.title, c.passage.page ? `p.${c.passage.page}` : '', c.passage.profName].filter(Boolean).join(' · '),
    }))
    // The quiz dialog lives in Ask SCRIBE, so here SCRIBE offers to set it up there.
    const text = reply.autoQuiz
      ? `Let’s see what you know! I found ${all.length} passage${all.length === 1 ? '' : 's'} to quiz you on. Open Ask SCRIBE and I’ll set up the quiz.`
      : reply.note ?? (all.length ? 'Here’s what I found.' : 'I couldn’t find that in the uploaded materials yet.')
    setMessages(m => [...m,
      { id: `u${Date.now()}`, from: 'user', text: question },
      { id: `s${Date.now()}`, from: 'scribe', text, cells, more: Math.max(0, all.length - MAX_CELLS), ask: all.length ? question : undefined, quiz: reply.autoQuiz },
    ])
    setInput('')
  }

  const firstName = user.firstName || user.name.split(' ')[0]

  return <div className={`scribe-widget ${open ? 'open' : ''}`}>
    {open && <section className="scribe-panel" role="dialog" aria-label="Chat with SCRIBE">
      <header>
        <ScribeAvatar badge size={38} />
        <div><strong>SCRIBE</strong><span>{mode === 'instructor' ? 'Your teaching assistant' : 'Your study buddy'}</span></div>
        <button className="icon-button" aria-label="Close chat" onClick={() => setOpen(false)}><X /></button>
      </header>
      <div className="scribe-thread" ref={scroller}>
        <div className="scribe-msg scribe"><ScribeAvatar badge size={28} /><div className="bubble">{SCRIBE_GREETING.replace('Hello,', `Hello ${firstName},`)}</div></div>
        {messages.map(m => m.from === 'user'
          ? <div key={m.id} className="scribe-msg user"><div className="bubble">{m.text}</div></div>
          : <div key={m.id} className="scribe-msg scribe"><ScribeAvatar badge size={28} /><div className="bubble">
            <p>{m.text}</p>
            {!!m.cells?.length && <ul className="mini-cells">{m.cells.map((c, i) => <li key={i}>{c.heading && <strong>{c.heading}</strong>}<span>{c.excerpt}</span><small>{c.source}</small></li>)}</ul>}
            {m.ask && <Link className="text-button" href={`/?ask=${encodeURIComponent(m.ask)}`}>{m.quiz ? 'Set up the quiz in Ask SCRIBE →' : m.more ? `See all ${m.more + (m.cells?.length ?? 0)} in Ask SCRIBE →` : 'Open in Ask SCRIBE →'}</Link>}
          </div></div>)}
        {loading && <div className="scribe-msg scribe"><ScribeAvatar badge size={28} /><div className="bubble typing"><Loader2 className="spin" /> Getting your course materials…</div></div>}
      </div>
      {!!chips.length && messages.length < 2 && <div className="scribe-chips">{chips.map(c => <button key={c} onClick={() => ask(c)}>{c}</button>)}</div>}
      <form className="scribe-input" onSubmit={e => { e.preventDefault(); ask(input) }}>
        <input value={input} onChange={e => setInput(e.target.value)} placeholder={library ? 'Ask me anything…' : 'Loading…'} disabled={!library} aria-label="Message SCRIBE" />
        <button className="send-button" disabled={!input.trim() || !library} aria-label="Send"><Send /></button>
      </form>
    </section>}

    {!open && teaser && <button className="scribe-teaser" onClick={() => { setTeaser(false); setOpen(true) }}>{SCRIBE_GREETING}</button>}
    <button className="scribe-launcher" aria-label={open ? 'Hide SCRIBE' : 'Chat with SCRIBE'} aria-expanded={open} onClick={() => { setTeaser(false); setOpen(o => !o) }}>
      <ScribeAvatar badge size={60} />
    </button>
  </div>
}
