'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, BookOpen, Check, Menu, RotateCcw, X } from 'lucide-react'
import { StudentSidebar } from '@/components/student/sidebar'
import { ThemeToggle } from '@/components/theme-toggle'
import { signOut, useSession } from '@/lib/session'
import { QUIZ_KINDS } from '@/lib/quiz'
import { attemptsOf } from '@/lib/brain'
import { gradeEnumeration, isAnswered, pointsFor, recordAttempt, reshuffleOptions, retakeOrder, score, type Response } from '@/lib/review'
import { deleteSet, listSets, MAX_STUDY_SETS, putSet, toReview, type SavedStudySet } from '@/lib/studysets'
import { archiveOpenChat, deleteChat, listChats, type RecentChat } from '@/lib/recents'
import type { StudyItem } from '@/types'
import '../student.css'

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const kindLabel = (s: SavedStudySet) => QUIZ_KINDS.find(k => k.kind === s.kind)?.label ?? 'Quiz'
const sourceLine = (item: StudyItem) => {
  const c = item.citations?.[0]
  return c ? `${c.materialTitle}${c.subjectCode ? ` · ${c.subjectCode}` : ''}${c.page ? ` · p.${c.page}` : ''}` : ''
}
const INSTRUCTION: Record<StudyItem['type'], string> = {
  quiz: 'Choose the term that fills the blank.', identification: 'Identify the term being described.',
  enumeration: 'Fill in every item. Any order is fine.', flashcard: 'Recall the meaning, then flip the card.', note: '',
}

/** One question: answer controls before submitting, and right/wrong feedback after. */
function Question({ item, n, response, onChange, submitted, missedBefore }: {
  item: StudyItem; n: number; response: Response | undefined; onChange: (r: Response) => void; submitted: boolean; missedBefore: boolean
}) {
  const [flipped, setFlipped] = useState(false)
  const earned = score(item, response), full = pointsFor(item)
  const verdict = !submitted ? '' : earned === full ? 'right' : earned > 0 ? 'partial' : 'wrong'

  return <article className={`question ${verdict}`}>
    <div className="q-num">
      Question {n}{item.type === 'enumeration' ? ` · ${full} points` : ''}
      {missedBefore && !submitted && <span className="review-tag">Missed last time</span>}
      {submitted && <span className={`verdict ${verdict}`}>{item.type === 'flashcard' ? (earned ? 'Knew it' : 'Still learning') : verdict === 'right' ? 'Correct' : verdict === 'partial' ? `${earned} of ${full}` : 'Incorrect'}</span>}
    </div>
    <p className="q-instruction">{INSTRUCTION[item.type]}</p>

    {item.type === 'quiz' && <>
      <p className="prompt">{item.prompt}</p>
      <fieldset className="options" disabled={submitted}>
        <legend className="sr-only">Choices</legend>
        {item.options!.map((opt, oi) => {
          const state = !submitted ? (response?.choice === oi ? 'chosen' : '') : oi === item.answerIndex ? 'correct' : response?.choice === oi ? 'wrong' : ''
          return <label key={oi} className={`option ${state}`}>
            <input type="radio" name={item.id} checked={response?.choice === oi} onChange={() => onChange({ choice: oi })} />
            {opt}
            {state === 'correct' && <Check aria-label="Correct answer" />}{state === 'wrong' && <X aria-label="Your answer" />}
          </label>
        })}
      </fieldset>
    </>}

    {item.type === 'identification' && <>
      <p className="prompt">{item.prompt}</p>
      <input className={`typed ${submitted ? (earned ? 'correct' : 'wrong') : ''}`} value={response?.text ?? ''} disabled={submitted} placeholder="Type the term" aria-label={`Answer to question ${n}`} onChange={e => onChange({ text: e.target.value })} />
      {submitted && !earned && <p className="expected">Answer: <strong>{item.answer}</strong></p>}
    </>}

    {item.type === 'enumeration' && (() => {
      const entries = response?.entries ?? item.answers!.map(() => '')
      const graded = submitted ? gradeEnumeration(entries, item.answers!) : null
      return <>
        <p className="prompt">{item.prompt}</p>
        <ol className="enum-inputs">{entries.map((v, i) => <li key={i}>
          <input className={`typed ${graded ? (graded.entryOk[i] ? 'correct' : 'wrong') : ''}`} value={v} disabled={submitted} aria-label={`Item ${i + 1} of ${entries.length}`}
            onChange={e => onChange({ entries: entries.map((x, j) => (j === i ? e.target.value : x)) })} />
        </li>)}</ol>
        {graded && graded.points < full && <p className="expected">Missed: <strong>{item.answers!.filter((_, i) => !graded.matched[i]).join(', ')}</strong></p>}
      </>
    })()}

    {item.type === 'flashcard' && <>
      <button type="button" className={`flashcard ${flipped || submitted ? 'flipped' : ''}`} onClick={() => setFlipped(f => !f)} aria-label={flipped ? 'Show front' : 'Flip card'}>
        {flipped || submitted ? <span className="back">{item.back}</span> : <span className="front">{item.front}</span>}
        <small>{flipped || submitted ? 'Back' : 'Front · click to flip'}</small>
      </button>
      {(flipped || submitted) && <div className="knew-row" role="group" aria-label="Did you know it?">
        <button type="button" disabled={submitted} className={response?.knew === true ? 'on' : ''} onClick={() => onChange({ knew: true })}><Check /> I knew it</button>
        <button type="button" disabled={submitted} className={response?.knew === false ? 'on' : ''} onClick={() => onChange({ knew: false })}><X /> Still learning</button>
      </div>}
    </>}

    {submitted && <p className="feedback"><strong>From your materials:</strong> “{item.explanation}” <br />{sourceLine(item)}</p>}
  </article>
}

function QuizPlayer({ set, onBack, onUpdate }: { set: SavedStudySet; onBack: () => void; onUpdate: (s: SavedStudySet) => void }) {
  const [responses, setResponses] = useState<Record<string, Response>>({})
  const [submitted, setSubmitted] = useState(false)
  const [take, setTake] = useState(0)
  const [retakeNote, setRetakeNote] = useState('')

  const answered = set.items.filter(i => isAnswered(i, responses[i.id])).length
  const total = set.items.reduce((a, i) => a + pointsFor(i), 0)
  const earned = set.items.reduce((a, i) => a + score(i, responses[i.id]), 0)

  const finish = () => {
    const results = Object.fromEntries(set.items.map(i => [i.id, score(i, responses[i.id]) === pointsFor(i)]))
    const attempt = { correct: earned, total, at: new Date().toISOString() }
    onUpdate({ ...set, review: recordAttempt(set.review, results), attempts: set.attempts + 1, lastScore: attempt, history: [...attemptsOf(set), attempt] })
    setSubmitted(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Spaced repetition: what was missed comes first, weakest boxes next, and multiple-choice options are reshuffled.
  const retake = (s: SavedStudySet = set) => {
    const order = retakeOrder(s.items.map(i => i.id), s.review)
    const byId = new Map(s.items.map(i => [i.id, i]))
    const missed = s.items.filter(i => s.review[i.id] && !s.review[i.id].lastCorrect).length
    onUpdate({ ...s, items: order.map(id => reshuffleOptions(byId.get(id)!)) })
    setResponses({}); setSubmitted(false); setTake(t => t + 1)
    setRetakeNote(missed ? `Retake: the ${missed} question${missed === 1 ? '' : 's'} you missed ${missed === 1 ? 'is' : 'are'} first, then the ones you know least.` : 'Retake: all correct last time, so the questions are reshuffled.')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Reopening a set that was taken before is a retake too.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (set.attempts > 0) retake() }, [])

  return <div className="quiz-player">
    <button className="text-button back" onClick={onBack}><ArrowLeft size={14} /> All study sets</button>
    <div className="sets-head"><div><h1>{set.title}</h1><p>{kindLabel(set)} · {set.items.length} question{set.items.length === 1 ? '' : 's'} · from {set.sourceCount} answer cell{set.sourceCount === 1 ? '' : 's'}{set.subjectCodes.length ? ` · ${set.subjectCodes.join(', ')}` : ''}</p></div></div>
    {submitted
      ? <div className="score-banner" role="status"><strong>{earned}/{total}</strong><span>{earned === total ? 'Perfect score.' : 'Scroll down to see what you missed. Each question shows the passage it came from.'}</span><button className="primary-button" onClick={() => retake()}><RotateCcw size={15} /> Retake</button></div>
      : retakeNote && <p className="retake-note">{retakeNote}</p>}
    {set.items.map((item, i) => <Question key={`${take}-${item.id}`} item={item} n={i + 1} response={responses[item.id]} submitted={submitted}
      missedBefore={take > 0 && !!set.review[item.id] && !set.review[item.id].lastCorrect}
      onChange={r => setResponses(prev => ({ ...prev, [item.id]: r }))} />)}
    {!submitted && <div className="player-actions">
      <span className="sets-meter">{answered} of {set.items.length} answered</span>
      <button className="primary-button" disabled={answered < set.items.length} onClick={finish}>Finish quiz</button>
    </div>}
    {submitted && <div className="player-actions"><button className="primary-button" onClick={() => retake()}><RotateCcw size={15} /> Retake</button></div>}
  </div>
}

export default function StudySetsPage() {
  const router = useRouter()
  const user = useSession()
  const uid = user?.uid
  const [collapsed, setCollapsed] = useState(false)
  const [sets, setSets] = useState<SavedStudySet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [recents, setRecents] = useState<RecentChat[]>([])

  useEffect(() => {
    if (!uid) return
    setOpenId(new URLSearchParams(window.location.search).get('open'))
    listSets(uid).then(setSets).catch(() => setError('Couldn’t load your study sets. Check your connection and reload.')).finally(() => setLoading(false))
    listChats(uid).then(setRecents).catch(() => {})
  }, [uid])

  const saveFailed = () => setError('Your latest change couldn’t be saved. Check your connection.')
  const updateSet = (s: SavedStudySet) => { setSets(list => list.map(x => (x.id === s.id ? s : x))); if (uid) putSet(uid, s).catch(saveFailed) }
  const removeSet = (id: string) => { setSets(list => list.filter(x => x.id !== id)); if (uid) deleteSet(uid, id).catch(saveFailed) }
  const open = (id: string | null) => { setOpenId(id); window.history.replaceState(null, '', id ? `/study-sets?open=${id}` : '/study-sets') }
  const logout = async () => { if (uid) await archiveOpenChat(uid).catch(() => {}); await signOut(); router.replace('/login') }

  if (!user) return null
  const current = sets.find(s => s.id === openId)

  return <div className="app-shell">
    <StudentSidebar user={user} active="sets" collapsed={collapsed} setCollapsed={setCollapsed} onLogout={logout}
      recents={recents} onOpenRecent={id => router.push(`/?chat=${id}`)}
      onDeleteRecent={id => { setRecents(list => list.filter(c => c.id !== id)); if (uid) deleteChat(uid, id).catch(saveFailed) }} />
    <main className="sets-main">
      <header className="mobile-header"><button className="icon-button" aria-label="Open sidebar" onClick={() => setCollapsed(false)}><Menu /></button><span className="brand">SCRIBE</span><ThemeToggle compact /></header>
      {error && <p className="field-error" role="alert">{error}</p>}
      {current
        ? <QuizPlayer key={current.id} set={current} onBack={() => open(null)} onUpdate={updateSet} />
        : <>
          <div className="sets-head">
            <div><h1>Study sets</h1><p>Quizzes you made from SCRIBE&apos;s answers.</p></div>
            <span className={`sets-meter ${sets.length >= MAX_STUDY_SETS ? 'full' : ''}`}><strong>{sets.length}</strong> of {MAX_STUDY_SETS} used</span>
          </div>
          {loading ? <p className="muted-line">Loading…</p> : sets.length === 0
            ? <div className="empty-materials"><BookOpen /><strong>No study sets yet</strong><span>In Ask SCRIBE, choose <b>Create quiz</b>, tick the answer cells you want, and name your quiz.</span><Link className="outline-button" href="/">Ask SCRIBE</Link></div>
            : <div className="sets-grid">{sets.map(s => <article key={s.id} className="set-card">
              <span className="kind-chip">{kindLabel(s)}</span>
              <h2>{s.title}</h2>
              <span className="meta">{s.items.length} question{s.items.length === 1 ? '' : 's'}{s.subjectCodes.length ? ` · ${s.subjectCodes.join(', ')}` : ''}</span>
              <span className="meta">Created {formatDate(s.createdAt)}{s.attempts ? ` · taken ${s.attempts}×` : ''}</span>
              {s.lastScore && <span className="score">Last score: {s.lastScore.correct}/{s.lastScore.total}{toReview(s) ? <em> · {toReview(s)} to review</em> : ''}</span>}
              <div className="actions">
                {confirmId === s.id
                  ? <span className="confirm">Delete this set?<button className="text-button" onClick={() => { removeSet(s.id); setConfirmId(null) }}>Delete</button><button className="text-button" onClick={() => setConfirmId(null)}>Keep</button></span>
                  : <><button className="primary-button" onClick={() => open(s.id)}>{s.attempts ? 'Retake' : 'Start'}</button><button className="text-button" onClick={() => setConfirmId(s.id)}>Delete</button></>}
              </div>
            </article>)}</div>}
        </>}
    </main>
  </div>
}
